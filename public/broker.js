const token = localStorage.getItem("kapfi_token");
const user = safeParse(localStorage.getItem("kapfi_user"));

const whoami = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const refreshBtn = document.getElementById("refreshBtn");
const dealTableBody = document.getElementById("dealTableBody");

guard();
whoami.textContent = `${user.name} (${user.email})`;

loadDeals();

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("kapfi_token");
  localStorage.removeItem("kapfi_user");
  window.location.href = "/login.html";
});

refreshBtn.addEventListener("click", loadDeals);

async function loadDeals() {
  try {
    const result = await api("/api/deals");
    render(result.deals || []);
  } catch (error) {
    alert(error.message);
  }
}

function render(deals) {
  dealTableBody.innerHTML = "";
  if (deals.length === 0) {
    dealTableBody.innerHTML = "<tr><td colspan='7'>No deals assigned to you yet.</td></tr>";
    return;
  }

  deals.forEach((deal) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHTML(deal.deal_name)}</td>
      <td><span class="pill">${escapeHTML(deal.stage_label)}</span></td>
      <td>${deal.offer_amount ? formatCurrency(deal.offer_amount) : "-"}</td>
      <td>${deal.offer_term_value && deal.offer_term_unit ? `${deal.offer_term_value} ${deal.offer_term_unit}` : "-"}</td>
      <td>${deal.factor_rate ? `${deal.factor_rate}x` : "-"}</td>
      <td>${escapeHTML(deal.next_action)}</td>
      <td>${formatDate(deal.submitted_at)}</td>
    `;
    dealTableBody.appendChild(tr);
  });
}

async function api(url, options = {}) {
  const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function guard() {
  if (!token || !user || user.role !== "broker") {
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

function formatDate(iso) {
  return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }).format(
    new Date(iso)
  );
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
