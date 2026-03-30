const STAGES = [
  "Submission Received",
  "In Pricing",
  "Offer",
  "Declined",
  "Docs Requested",
  "Docs Sent",
  "In Login",
  "Call Completed Working on Report",
  "Funded"
];
const OFFER_STAGE_INDEX = 2;
const DECLINED_STAGE_INDEX = 3;
const token = localStorage.getItem("kapfi_token");
const user = safeParse(localStorage.getItem("kapfi_user"));

const whoami = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const inviteForm = document.getElementById("inviteForm");
const inviteMsg = document.getElementById("inviteMsg");
const inviteLinkInput = document.getElementById("inviteLink");
const dealForm = document.getElementById("dealForm");
const brokerSelect = document.getElementById("brokerSelect");
const dealMsg = document.getElementById("dealMsg");
const dealTableBody = document.getElementById("dealTableBody");
const refreshBtn = document.getElementById("refreshBtn");

guard();
whoami.textContent = `${user.name} (${user.email})`;

let brokers = [];
let deals = [];

bootstrap();

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("kapfi_token");
  localStorage.removeItem("kapfi_user");
  window.location.href = "/login.html";
});

inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  inviteMsg.classList.remove("error");
  inviteMsg.textContent = "";
  const formData = new FormData(inviteForm);

  try {
    const result = await api("/api/admin/broker-invites", {
      method: "POST",
      body: JSON.stringify({ email: String(formData.get("email") || "").trim() })
    });
    inviteMsg.textContent = `Invite created for ${result.invite.email}`;
    inviteLinkInput.value = result.invite.signupUrl;
    inviteForm.reset();
    inviteLinkInput.select();
  } catch (error) {
    inviteMsg.classList.add("error");
    inviteMsg.textContent = error.message;
  }
});

dealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  dealMsg.classList.remove("error");
  dealMsg.textContent = "";
  const formData = new FormData(dealForm);
  try {
    await api("/api/admin/deals", {
      method: "POST",
      body: JSON.stringify({
        brokerId: Number(formData.get("brokerId")),
        dealName: String(formData.get("dealName") || "").trim()
      })
    });
    dealMsg.textContent = "Deal created.";
    dealForm.reset();
    await loadDeals();
  } catch (error) {
    dealMsg.classList.add("error");
    dealMsg.textContent = error.message;
  }
});

refreshBtn.addEventListener("click", async () => {
  await loadBrokers();
  await loadDeals();
});

async function bootstrap() {
  await loadBrokers();
  await loadDeals();
}

async function loadBrokers() {
  const result = await api("/api/admin/brokers");
  brokers = result.brokers || [];
  brokerSelect.innerHTML = "";
  brokers.forEach((broker) => {
    const option = document.createElement("option");
    option.value = String(broker.id);
    option.textContent = `${broker.name} (${broker.email})`;
    brokerSelect.appendChild(option);
  });
}

async function loadDeals() {
  const result = await api("/api/deals");
  deals = result.deals || [];
  renderDeals();
}

function renderDeals() {
  dealTableBody.innerHTML = "";
  if (deals.length === 0) {
    dealTableBody.innerHTML = "<tr><td colspan='6'>No deals yet.</td></tr>";
    return;
  }

  deals.forEach((deal) => {
    const tr = document.createElement("tr");
    const stageOptions = STAGES.map(
      (label, index) => `<option value="${index}" ${deal.stage === index ? "selected" : ""}>${label}</option>`
    ).join("");

    const brokerOptions = brokers
      .map(
        (broker) =>
          `<option value="${broker.id}" ${deal.broker_id === broker.id ? "selected" : ""}>${escapeHTML(
            broker.name
          )}</option>`
      )
      .join("");

    const offerSummary =
      deal.offer_amount && deal.offer_term_value && deal.offer_term_unit && deal.factor_rate
        ? `${formatCurrency(deal.offer_amount)} | ${deal.offer_term_value} ${deal.offer_term_unit} | ${deal.factor_rate}x`
        : "Not set";

    tr.innerHTML = `
      <td>${escapeHTML(deal.deal_name)}</td>
      <td>${escapeHTML(deal.broker_name)}</td>
      <td><span class="pill">${escapeHTML(deal.stage_label)}</span></td>
      <td>${escapeHTML(offerSummary)}</td>
      <td>${escapeHTML(deal.next_action)}</td>
      <td>
        <div class="controls">
          <select data-type="stage">${stageOptions}</select>
          <select data-type="broker">${brokerOptions}</select>
          <input data-type="dealName" value="${escapeHTMLAttr(deal.deal_name)}" placeholder="Deal Name" />
          <input data-type="offerAmount" type="number" min="0" step="1000" value="${deal.offer_amount || ""}" placeholder="Offer Amount" />
          <input data-type="offerTermValue" type="number" min="1" step="1" value="${deal.offer_term_value || ""}" placeholder="Term Value" />
          <select data-type="offerTermUnit">
            <option value="">Term Unit</option>
            <option value="daily" ${deal.offer_term_unit === "daily" ? "selected" : ""}>Daily</option>
            <option value="weekly" ${deal.offer_term_unit === "weekly" ? "selected" : ""}>Weekly</option>
          </select>
          <input data-type="factorRate" type="number" min="0" step="0.01" value="${deal.factor_rate || ""}" placeholder="Factor Rate" />
          <button data-id="${deal.id}" data-type="save">Save</button>
        </div>
      </td>
    `;

    dealTableBody.appendChild(tr);
    enforceOfferInputs(tr);
  });

  dealTableBody.querySelectorAll("select[data-type='stage']").forEach((select) => {
    select.addEventListener("change", () => {
      const row = select.closest("tr");
      enforceOfferInputs(row);
    });
  });

  dealTableBody.querySelectorAll("button[data-type='save']").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      const id = Number(button.dataset.id);
      const stage = Number(row.querySelector("select[data-type='stage']").value);
      const brokerId = Number(row.querySelector("select[data-type='broker']").value);
      const dealName = row.querySelector("input[data-type='dealName']").value.trim();
      const offerAmount = row.querySelector("input[data-type='offerAmount']").value.trim();
      const offerTermValue = row.querySelector("input[data-type='offerTermValue']").value.trim();
      const offerTermUnit = row.querySelector("select[data-type='offerTermUnit']").value.trim();
      const factorRate = row.querySelector("input[data-type='factorRate']").value.trim();

      button.disabled = true;
      try {
        await api(`/api/admin/deals/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            stage,
            brokerId,
            dealName,
            offerAmount: offerAmount === "" ? null : Number(offerAmount),
            offerTermValue: offerTermValue === "" ? null : Number(offerTermValue),
            offerTermUnit: offerTermUnit || null,
            factorRate: factorRate === "" ? null : Number(factorRate)
          })
        });
        await loadDeals();
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });
}

function enforceOfferInputs(row) {
  if (!row) {
    return;
  }
  const stage = Number(row.querySelector("select[data-type='stage']").value);
  const required = stage >= OFFER_STAGE_INDEX && stage !== DECLINED_STAGE_INDEX;
  ["offerAmount", "offerTermValue", "offerTermUnit", "factorRate"].forEach((type) => {
    const input = row.querySelector(`input[data-type='${type}']`);
    const select = row.querySelector(`select[data-type='${type}']`);
    const field = input || select;
    if (field) {
      field.required = required;
      field.disabled = !required;
    }
  });
}

async function api(url, options = {}) {
  const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function guard() {
  if (!token || !user || user.role !== "admin") {
    window.location.href = "/login.html";
  }
}

function safeParse(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHTMLAttr(value) {
  return escapeHTML(value).replace(/`/g, "&#96;");
}
