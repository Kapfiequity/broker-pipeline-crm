const form = document.getElementById("signupForm");
const emailInput = document.getElementById("email");
const messageEl = document.getElementById("message");
const errorEl = document.getElementById("error");

const token = new URLSearchParams(window.location.search).get("token") || "";

bootstrap();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  messageEl.textContent = "";
  errorEl.textContent = "";

  const formData = new FormData(form);
  const payload = {
    token,
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || "")
  };

  try {
    const response = await fetch("/api/auth/broker-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Signup failed.");
    }

    messageEl.textContent = "Account created. Redirecting to login...";
    form.reset();
    setTimeout(() => {
      window.location.href = "/login.html";
    }, 900);
  } catch (error) {
    errorEl.textContent = error.message;
  }
});

async function bootstrap() {
  if (!token) {
    errorEl.textContent = "Missing invite token. Please use the signup link from Kapfi.";
    form.querySelector("button").disabled = true;
    return;
  }

  try {
    const response = await fetch(`/api/auth/invite/${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Invite is invalid.");
    }
    emailInput.value = data.email;
    emailInput.readOnly = true;
  } catch (error) {
    errorEl.textContent = error.message;
    form.querySelector("button").disabled = true;
  }
}
