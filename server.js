// server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const connectDB = require("./config/db");
const multer = require("multer");

// Import routes
const authRoutes = require("./routes/auth");
const propertyRoutes = require("./routes/property");
const chatRoutes = require("./routes/chat");
const messageRoutes = require("./routes/message");
const favoriteRoutes = require("./routes/favorite");
const userRoutes = require("./routes/user");
const transactionRoutes = require("./routes/transaction");
const inspectionRoutes = require("./routes/inspection");
const purchaseRoutes = require("./routes/purchase");
const adsRoutes = require("./routes/ads");
const bankRoutes = require("./routes/bank");
const ratingRoutes = require("./routes/rating");
const disputeRoutes = require("./routes/dispute");
const notificationRoutes = require("./routes/notification");
const escrowRoutes = require("./routes/escrow");
const feedbackRoutes = require("./routes/feedback");

// Import socket handler
const socketHandler = require("./middlewares/socket");

// Initialize Express
const app = express();
const server = http.createServer(app);

// ------------------------
// Socket.IO setup with JWT Handshake Authentication
// ------------------------
const io = new Server(server, { cors: { origin: "*" } });

global.io = io;
global.onlineUsers = new Map();

io.use((socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token || socket.handshake.headers?.token;
    if (!token) {
      return next(new Error("Authentication error: Token missing"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded; // Attach user info to socket
    next();
  } catch (err) {
    next(new Error("Authentication error: Invalid token"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.user?._id || socket.user?.id;
  if (userId) {
    socket.join(userId.toString());
  }
});

// Initialize additional socket logic handler
socketHandler(io, global.onlineUsers);

// ------------------------
// Middleware & Raw Body Parser for Paystack Webhooks
// ------------------------
app.use(cors());

app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      // Capture raw body for Paystack webhook signature verification
      if (req.originalUrl && req.originalUrl.includes("/webhook")) {
        req.rawBody = buf.toString();
      }
    },
  }),
);

app.use(express.urlencoded({ extended: true }));

// ------------------------
// Connect MongoDB
// ------------------------
connectDB();

// ------------------------
// Test routes
// ------------------------
app.get("/", (req, res) =>
  res.send("RealEstate Server is running 🚀[cite: 10]"),
);
app.get("/api", (req, res) =>
  res.send("RealEstate API is running 🚀[cite: 10]"),
);

// ------------------------
// Mount API routes
// ------------------------
app.use("/api/auth", authRoutes);
app.use("/api/property", propertyRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/message", messageRoutes);
app.use("/api/favorite", favoriteRoutes);
app.use("/api/user", userRoutes);
app.use("/api/transaction", transactionRoutes);
app.use("/api/inspection", inspectionRoutes);
app.use("/api/purchase", purchaseRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/bank", bankRoutes);
app.use("/api/rating", ratingRoutes);
app.use("/api/dispute", disputeRoutes);
app.use("/api/notification", notificationRoutes);
app.use("/api/escrow", escrowRoutes);
app.use("/api/feedback", feedbackRoutes);

// ------------------------
// Start server
// ------------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}[cite: 10]`),
);
