const form = document.getElementById("loginForm");
const errorEl = document.getElementById("error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";

  const formData = new FormData(form);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Login failed.");
    }

    localStorage.setItem("kapfi_token", data.token);
    localStorage.setItem("kapfi_user", JSON.stringify(data.user));

    if (data.user.role === "admin") {
      window.location.href = "/admin.html";
      return;
    }
    window.location.href = "/broker.html";
  } catch (error) {
    errorEl.textContent = error.message;
  }
});
