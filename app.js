const STAGES = [
  "Submitted",
  "Intake",
  "Ready for Pricing",
  "Pricing",
  "Offer Options Sent",
  "Contracts Out",
  "Final Diligence",
  "Funded"
];

const STORAGE_KEY = "broker_pipeline_deals_v2";

const form = document.getElementById("dealForm");
const formPanel = document.getElementById("formPanel");
const toggleFormBtn = document.getElementById("toggleFormBtn");
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const stageTracker = document.getElementById("stageTracker");
const tableBody = document.getElementById("dealTableBody");
const dealCount = document.getElementById("dealCount");
const pipelineSummary = document.getElementById("pipelineSummary");

let deals = loadDeals();
let query = "";
let sortMode = "recent";
let selectedStage = null;

render();

toggleFormBtn.addEventListener("click", () => {
  formPanel.classList.toggle("hidden");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(form);

  const brokerName = String(formData.get("brokerName") || "").trim();
  const clientName = String(formData.get("clientName") || "").trim();
  const legalName = String(formData.get("dealName") || "").trim();
  const advanceAmount = Number(formData.get("dealValue") || 0);
  const nextAction = String(formData.get("notes") || "").trim() || "Review file and follow up";

  const now = new Date();
  const deal = {
    id: crypto.randomUUID(),
    accountId: buildAccountId(),
    brokerName,
    clientName,
    legalName,
    advanceAmount,
    nextAction,
    stage: 1,
    submittedAt: now.toISOString()
  };

  deals.unshift(deal);
  persistDeals();
  form.reset();
  formPanel.classList.add("hidden");
  render();
});

searchInput.addEventListener("input", () => {
  query = searchInput.value.trim().toLowerCase();
  render();
});

sortSelect.addEventListener("change", () => {
  sortMode = sortSelect.value;
  render();
});

function render() {
  renderStageTracker();
  renderTable();
  renderSummary();
}

function renderStageTracker() {
  stageTracker.innerHTML = "";

  STAGES.forEach((name, index) => {
    const count = deals.filter((deal) => deal.stage === index).length;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "stage-chip";
    chip.textContent = name;

    if (selectedStage === index) {
      chip.classList.add("is-active");
    }
    if (index === STAGES.length - 1) {
      chip.classList.add("is-end");
    }

    chip.addEventListener("click", () => {
      selectedStage = selectedStage === index ? null : index;
      render();
    });

    const badge = document.createElement("span");
    badge.className = `count-badge ${count > 0 ? "has-items" : ""}`;
    badge.textContent = String(count);
    chip.appendChild(badge);

    stageTracker.appendChild(chip);
  });
}

function renderTable() {
  const rows = getVisibleDeals();
  tableBody.innerHTML = "";

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    tr.innerHTML = `<td colspan="8">No deals found for this filter.</td>`;
    tableBody.appendChild(tr);
    return;
  }

  rows.forEach((deal) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="account">${deal.accountId}</td>
      <td>${escapeHTML(deal.clientName)}</td>
      <td>${escapeHTML(deal.legalName)}</td>
      <td>${formatDate(deal.submittedAt)}</td>
      <td>${daysSince(deal.submittedAt)}</td>
      <td>${formatCurrency(deal.advanceAmount)}</td>
      <td><span class="status-pill stage-${deal.stage}">${STAGES[deal.stage]}</span></td>
      <td>
        <div class="action-cell">
          <span>${escapeHTML(deal.nextAction)}</span>
          <div class="stage-actions">
            <button class="icon-btn" data-dir="-1" data-id="${deal.id}" ${deal.stage === 0 ? "disabled" : ""}>-</button>
            <button class="icon-btn" data-dir="1" data-id="${deal.id}" ${deal.stage === STAGES.length - 1 ? "disabled" : ""}>+</button>
          </div>
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
  });

  tableBody.querySelectorAll(".icon-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const direction = Number(btn.dataset.dir);
      moveStage(id, direction);
    });
  });
}

function renderSummary() {
  const visible = getVisibleDeals();
  dealCount.textContent = `${visible.length} ${visible.length === 1 ? "deal" : "deals"}`;

  if (selectedStage === null) {
    pipelineSummary.textContent = `All (${visible.length})`;
    return;
  }

  pipelineSummary.textContent = `${STAGES[selectedStage]} (${visible.length})`;
}

function getVisibleDeals() {
  let list = deals.filter((deal) => {
    const inSearch = `${deal.accountId} ${deal.clientName} ${deal.legalName} ${deal.brokerName}`.toLowerCase().includes(query);
    const inStage = selectedStage === null || deal.stage === selectedStage;
    return inSearch && inStage;
  });

  list = [...list].sort((a, b) => {
    if (sortMode === "oldest") {
      return new Date(a.submittedAt) - new Date(b.submittedAt);
    }
    if (sortMode === "amount") {
      return b.advanceAmount - a.advanceAmount;
    }
    return b.stage - a.stage || new Date(a.submittedAt) - new Date(b.submittedAt);
  });

  return list;
}

function moveStage(id, direction) {
  deals = deals.map((deal) => {
    if (deal.id !== id) {
      return deal;
    }
    return {
      ...deal,
      stage: clamp(deal.stage + direction, 0, STAGES.length - 1)
    };
  });

  persistDeals();
  render();
}

function loadDeals() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return seedDeals();
    }
  }
  return seedDeals();
}

function persistDeals() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deals));
}

function seedDeals() {
  return [
    {
      id: crypto.randomUUID(),
      accountId: "1363AF4E",
      brokerName: "David Maekitan",
      clientName: "DRINK LABS, LLC",
      legalName: "DRINK LABS, LLC",
      advanceAmount: 0,
      nextAction: "Collect updated bank statements",
      stage: 1,
      submittedAt: new Date().toISOString()
    }
  ];
}

function formatDate(iso) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  }).format(date);
}

function daysSince(iso) {
  const start = new Date(iso);
  const now = new Date();
  const diff = now - start;
  return Math.max(0, Math.floor(diff / 86400000));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

function buildAccountId() {
  return Math.random().toString(16).slice(2, 10).toUpperCase();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHTML(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
