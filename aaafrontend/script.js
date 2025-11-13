// --------------------------
// GOOGLE OAUTH CALLBACKS
// --------------------------

// Google Register
async function handleGoogleRegister(response) {
  try {
    const res = await fetch("http://localhost:8000/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId: response.credential, mode: "register" }),
    });

    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("token", data.token);
      alert("Registration via Google successful!");
      window.location.href = "dashboard.html";
    } else {
      alert(data.message || "Google registration failed");
    }
  } catch (err) {
    console.error("Google Register error:", err);
  }
}

// Google Login
async function handleGoogleLogin(response) {
  try {
    const res = await fetch("http://localhost:8000/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId: response.credential, mode: "login" }),
    });

    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("token", data.token);
      alert("Login via Google successful!");
      window.location.href = "dashboard.html";
    } else {
      alert(data.message || "Google login failed");
    }
  } catch (err) {
    console.error("Google Login error:", err);
  }
}

// --------------------------
// NORMAL LOGIN FORM
// --------------------------
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    try {
      const res = await fetch("http://localhost:8000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem("token", data.token);
        alert("Login successful!");
        window.location.href = "dashboard.html";
      } else {
        alert(data.message || "Login failed");
      }
    } catch (err) {
      console.error("Login error:", err);
    }
  });
}

// --------------------------
// NORMAL REGISTER FORM
// --------------------------
const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    try {
      const res = await fetch("http://localhost:8000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem("token", data.token);
        alert("Registration successful!");
        window.location.href = "dashboard.html";
      } else {
        alert(data.message || "Registration failed");
      }
    } catch (err) {
      console.error("Register error:", err);
    }
  });
}
