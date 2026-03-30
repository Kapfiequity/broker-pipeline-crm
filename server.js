const path = require("path");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "replace-this-with-a-secure-secret";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "kapfi.db");

const STAGES = ["Intake", "In Pricing", "Offer Sent", "Docs Sent", "Final Review", "Funded"];
const OFFER_STAGE_INDEX = 2;

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
initDatabase();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/stages", (req, res) => {
  res.json({ stages: STAGES });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = db
    .prepare("SELECT id, name, email, role, password_hash, active FROM users WHERE email = ?")
    .get(String(email).toLowerCase().trim());

  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

app.get("/api/auth/invite/:token", (req, res) => {
  const token = String(req.params.token || "");
  const invite = findInviteByToken(token);
  if (!invite) {
    return res.status(404).json({ error: "Invite not found." });
  }
  if (invite.used_at) {
    return res.status(400).json({ error: "This invite was already used." });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(400).json({ error: "This invite has expired." });
  }

  res.json({ email: invite.email, expiresAt: invite.expires_at });
});

app.post("/api/auth/broker-signup", (req, res) => {
  const { token, name, email, password } = req.body || {};
  if (!token || !name || !email || !password) {
    return res.status(400).json({ error: "Token, name, email, and password are required." });
  }

  const invite = findInviteByToken(String(token));
  if (!invite) {
    return res.status(400).json({ error: "Invalid invite link." });
  }
  if (invite.used_at) {
    return res.status(400).json({ error: "This invite was already used." });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(400).json({ error: "This invite has expired." });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  if (normalizedEmail !== invite.email) {
    return res.status(400).json({ error: "Email does not match invite." });
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists." });
  }

  const passwordHash = bcrypt.hashSync(String(password), 10);
  const result = db
    .prepare("INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, 'broker', 1)")
    .run(String(name).trim(), normalizedEmail, passwordHash);

  db.prepare("UPDATE broker_invites SET used_at = CURRENT_TIMESTAMP, used_user_id = ? WHERE id = ?").run(
    result.lastInsertRowid,
    invite.id
  );

  res.status(201).json({ ok: true });
});

app.get("/api/auth/me", authRequired, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/deals", authRequired, (req, res) => {
  const deals = req.user.role === "admin" ? listDeals() : listDeals(req.user.id);
  res.json({ deals });
});

app.get("/api/admin/brokers", authRequired, roleRequired("admin"), (req, res) => {
  const brokers = db
    .prepare("SELECT id, name, email, role, active, created_at FROM users WHERE role = 'broker' ORDER BY created_at DESC")
    .all();
  res.json({ brokers });
});

app.post("/api/admin/broker-invites", authRequired, roleRequired("admin"), (req, res) => {
  const email = String((req.body || {}).email || "").toLowerCase().trim();
  if (!email) {
    return res.status(400).json({ error: "Broker email is required." });
  }

  const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existingUser) {
    return res.status(409).json({ error: "That email already has an account." });
  }

  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    "INSERT INTO broker_invites (email, token_hash, created_by_user_id, expires_at) VALUES (?, ?, ?, ?)"
  ).run(email, tokenHash, req.user.id, expiresAt);

  const baseUrl = resolveBaseUrl(req);
  const signupUrl = `${baseUrl}/signup.html?token=${rawToken}`;
  res.status(201).json({ invite: { email, signupUrl, expiresAt } });
});

app.post("/api/admin/deals", authRequired, roleRequired("admin"), (req, res) => {
  const payload = req.body || {};
  const accountId = payload.accountId ? String(payload.accountId).trim() : buildAccountId();
  const brokerId = Number(payload.brokerId || 0);
  const dealName = String(payload.dealName || "").trim();
  const nextAction = String(payload.nextAction || "").trim() || "Review and update";
  const stage = clamp(Number(payload.stage || 0), 0, STAGES.length - 1);

  if (!brokerId || !dealName) {
    return res.status(400).json({ error: "Broker and deal name are required." });
  }

  const broker = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'broker' AND active = 1").get(brokerId);
  if (!broker) {
    return res.status(400).json({ error: "Assigned broker not found or inactive." });
  }

  const insert = db.prepare(
    `INSERT INTO deals (account_id, broker_id, deal_name, client_name, legal_name, advance_amount, next_action, stage)
     VALUES (?, ?, ?, '', '', 0, ?, ?)`
  );

  let result;
  try {
    result = insert.run(accountId, brokerId, dealName, nextAction, stage);
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Account id already exists. Try another one." });
    }
    throw error;
  }

  const dealId = result.lastInsertRowid;
  db.prepare("INSERT INTO deal_events (deal_id, actor_id, action, from_stage, to_stage) VALUES (?, ?, 'created', NULL, ?)").run(
    dealId,
    req.user.id,
    stage
  );

  res.status(201).json({ deal: getDealById(dealId) });
});

app.patch("/api/admin/deals/:id", authRequired, roleRequired("admin"), (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid deal id." });
  }

  const deal = db.prepare("SELECT * FROM deals WHERE id = ?").get(id);
  if (!deal) {
    return res.status(404).json({ error: "Deal not found." });
  }

  const payload = req.body || {};
  const updatedStage = payload.stage === undefined ? deal.stage : clamp(Number(payload.stage), 0, STAGES.length - 1);
  const updatedBrokerId = payload.brokerId === undefined ? deal.broker_id : Number(payload.brokerId);
  const updatedDealName = payload.dealName === undefined ? deal.deal_name : String(payload.dealName || "").trim();
  const updatedAction = payload.nextAction === undefined ? deal.next_action : String(payload.nextAction || "").trim();
  const updatedOfferAmount =
    payload.offerAmount === undefined ? deal.offer_amount : normalizeNumber(payload.offerAmount);
  const updatedOfferTerm =
    payload.offerTermMonths === undefined ? deal.offer_term_months : normalizeInteger(payload.offerTermMonths);
  const updatedFactorRate =
    payload.factorRate === undefined ? deal.factor_rate : normalizeNumber(payload.factorRate);

  if (!updatedBrokerId || Number.isNaN(updatedBrokerId)) {
    return res.status(400).json({ error: "Invalid broker id." });
  }
  if (!updatedDealName) {
    return res.status(400).json({ error: "Deal name is required." });
  }

  const broker = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'broker'").get(updatedBrokerId);
  if (!broker) {
    return res.status(400).json({ error: "Assigned broker not found." });
  }

  if (updatedStage >= OFFER_STAGE_INDEX) {
    if (!updatedOfferAmount || updatedOfferAmount <= 0) {
      return res.status(400).json({ error: "Offer Amount is required once deal reaches Offer Sent stage." });
    }
    if (!updatedOfferTerm || updatedOfferTerm <= 0) {
      return res.status(400).json({ error: "Offer Term is required once deal reaches Offer Sent stage." });
    }
    if (!updatedFactorRate || updatedFactorRate <= 0) {
      return res.status(400).json({ error: "Factor Rate is required once deal reaches Offer Sent stage." });
    }
  }

  db.prepare(
    `UPDATE deals
     SET stage = ?, broker_id = ?, deal_name = ?, next_action = ?, offer_amount = ?, offer_term_months = ?, factor_rate = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    updatedStage,
    updatedBrokerId,
    updatedDealName,
    updatedAction || "Review and update",
    updatedOfferAmount,
    updatedOfferTerm,
    updatedFactorRate,
    id
  );

  if (updatedStage !== deal.stage) {
    db.prepare("INSERT INTO deal_events (deal_id, actor_id, action, from_stage, to_stage) VALUES (?, ?, 'stage_change', ?, ?)").run(
      id,
      req.user.id,
      deal.stage,
      updatedStage
    );
  }

  if (updatedBrokerId !== deal.broker_id) {
    db.prepare(
      "INSERT INTO deal_events (deal_id, actor_id, action, from_stage, to_stage, details) VALUES (?, ?, 'broker_reassigned', ?, ?, ?)"
    ).run(id, req.user.id, deal.stage, updatedStage, JSON.stringify({ oldBrokerId: deal.broker_id, newBrokerId: updatedBrokerId }));
  }

  if (
    updatedOfferAmount !== deal.offer_amount ||
    updatedOfferTerm !== deal.offer_term_months ||
    updatedFactorRate !== deal.factor_rate
  ) {
    db.prepare(
      "INSERT INTO deal_events (deal_id, actor_id, action, from_stage, to_stage, details) VALUES (?, ?, 'offer_updated', ?, ?, ?)"
    ).run(
      id,
      req.user.id,
      deal.stage,
      updatedStage,
      JSON.stringify({
        offerAmount: updatedOfferAmount,
        offerTermMonths: updatedOfferTerm,
        factorRate: updatedFactorRate
      })
    );
  }

  res.json({ deal: getDealById(id) });
});

app.get("/api/admin/deals/:id/events", authRequired, roleRequired("admin"), (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid deal id." });
  }

  const events = db
    .prepare(
      `SELECT e.id, e.action, e.from_stage, e.to_stage, e.details, e.created_at, u.name AS actor_name
       FROM deal_events e
       LEFT JOIN users u ON e.actor_id = u.id
       WHERE e.deal_id = ?
       ORDER BY e.created_at DESC`
    )
    .all(id)
    .map((event) => ({
      ...event,
      from_stage_label: event.from_stage === null ? null : STAGES[event.from_stage],
      to_stage_label: event.to_stage === null ? null : STAGES[event.to_stage]
    }));

  res.json({ events });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Kapfi broker portal running on http://localhost:${PORT}`);
});

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT id, name, email, role, active FROM users WHERE id = ?").get(decoded.sub);
    if (!user || !user.active) {
      return res.status(401).json({ error: "Unauthorized." });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized." });
  }
}

function roleRequired(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "Forbidden." });
    }
    next();
  };
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'broker')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL UNIQUE,
      broker_id INTEGER NOT NULL,
      deal_name TEXT NOT NULL DEFAULT '',
      client_name TEXT NOT NULL DEFAULT '',
      legal_name TEXT NOT NULL DEFAULT '',
      advance_amount REAL NOT NULL DEFAULT 0,
      offer_amount REAL,
      offer_term_months INTEGER,
      factor_rate REAL,
      next_action TEXT NOT NULL DEFAULT 'Review and update',
      stage INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(broker_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS broker_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_by_user_id INTEGER NOT NULL,
      used_user_id INTEGER,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id),
      FOREIGN KEY(used_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS deal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      actor_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      from_stage INTEGER,
      to_stage INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(deal_id) REFERENCES deals(id),
      FOREIGN KEY(actor_id) REFERENCES users(id)
    );
  `);

  addColumnIfMissing("deals", "deal_name", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("deals", "offer_amount", "REAL");
  addColumnIfMissing("deals", "offer_term_months", "INTEGER");
  addColumnIfMissing("deals", "factor_rate", "REAL");

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@kapfi.co").toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const adminName = process.env.ADMIN_NAME || "Kapfi Admin";

  const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!existingAdmin) {
    const passwordHash = bcrypt.hashSync(adminPassword, 10);
    db.prepare("INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, 'admin', 1)").run(
      adminName,
      adminEmail,
      passwordHash
    );
    console.log(`Seed admin created: ${adminEmail} / ${adminPassword}`);
  }
}

function addColumnIfMissing(tableName, columnName, sqlType) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlType}`);
  }
}

function listDeals(forBrokerId) {
  const baseQuery =
    `SELECT d.id, d.account_id, d.deal_name, d.client_name, d.legal_name, d.advance_amount, d.offer_amount, d.offer_term_months, d.factor_rate, d.next_action, d.stage, d.submitted_at, d.updated_at,
            u.id AS broker_id, u.name AS broker_name, u.email AS broker_email
     FROM deals d
     JOIN users u ON d.broker_id = u.id`;

  const query = forBrokerId
    ? `${baseQuery} WHERE d.broker_id = ? ORDER BY d.updated_at DESC`
    : `${baseQuery} ORDER BY d.updated_at DESC`;

  const rows = forBrokerId ? db.prepare(query).all(forBrokerId) : db.prepare(query).all();
  return rows.map((row) => ({
    ...row,
    deal_name: row.deal_name || row.legal_name || row.client_name || "Untitled Deal",
    stage_label: STAGES[row.stage] || "Unknown"
  }));
}

function getDealById(id) {
  const row = db
    .prepare(
      `SELECT d.id, d.account_id, d.deal_name, d.client_name, d.legal_name, d.advance_amount, d.offer_amount, d.offer_term_months, d.factor_rate, d.next_action, d.stage, d.submitted_at, d.updated_at,
              u.id AS broker_id, u.name AS broker_name, u.email AS broker_email
       FROM deals d
       JOIN users u ON d.broker_id = u.id
       WHERE d.id = ?`
    )
    .get(id);

  if (!row) {
    return null;
  }
  return {
    ...row,
    deal_name: row.deal_name || row.legal_name || row.client_name || "Untitled Deal",
    stage_label: STAGES[row.stage] || "Unknown"
  };
}

function findInviteByToken(token) {
  if (!token) {
    return null;
  }
  const tokenHash = hashToken(token);
  return db.prepare("SELECT * FROM broker_invites WHERE token_hash = ?").get(tokenHash);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Math.trunc(num);
}

function clamp(value, min, max) {
  const numeric = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(numeric) ? numeric : min));
}

function buildAccountId() {
  return Math.random().toString(16).slice(2, 10).toUpperCase();
}

function resolveBaseUrl(req) {
  const origin = req.get("origin");
  if (origin) {
    return origin;
  }

  const forwardedProto = req.get("x-forwarded-proto");
  const host = req.get("host");
  if (host) {
    const proto = forwardedProto || "https";
    return `${proto}://${host}`;
  }

  return process.env.APP_BASE_URL || `http://localhost:${PORT}`;
}
