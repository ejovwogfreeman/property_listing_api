require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const connectDB = require("./config/db");

// Import routes
const authRoutes = require("./routes/auth");
const propertyRoutes = require("./routes/property");
const chatRoutes = require("./routes/chat");
const notificationRoutes = require("./routes/notification");
const escrowRoutes = require("./routes/escrow");

// Import models
const Notification = require("./models/notification");
const Message = require("./models/message");

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Connect MongoDB
connectDB();

// Test route
app.get("/", (req, res) => res.send("RealEstate Server is running 🚀"));
app.get("/api", (req, res) => res.send("RealEstate API is running 🚀"));

// Mount routes
app.use("/api/auth", authRoutes);
app.use("/api/property", propertyRoutes);
// app.use("/api/chat", chatRoutes);
// app.use("/api/notification", notificationRoutes);
// app.use("/api/escrow", escrowRoutes);

// Socket.io setup
const io = new Server(server, {
  cors: { origin: "*" },
});

// Attach io globally for controllers or routes to emit notifications
global.io = io;

// Track online users: userId -> socketId
global.onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log("🟢 New socket connected:", socket.id);

  // Register user online
  socket.on("user_connected", (userId) => {
    if (userId) {
      onlineUsers.set(userId.toString(), socket.id);
      console.log(`✅ User ${userId} connected via socket ${socket.id}`);
    }
  });

  // Send notification to a specific user
  socket.on("notify", async (data) => {
    try {
      const { userId, title, message, meta } = data || {};
      if (!userId) return;

      // Persist notification in MongoDB
      const notif = await Notification.create({
        user: userId,
        title,
        message,
        meta,
      });

      // Emit in real-time if user is online
      const targetSocket = onlineUsers.get(userId.toString());
      if (targetSocket) io.to(targetSocket).emit("notification", notif);
    } catch (err) {
      console.error("notify error:", err);
    }
  });

  // Chat: send message and persist
  socket.on("send_message", async (payload) => {
    try {
      const { from, to, text, attachments } = payload;
      if (!from || !to) return;

      const msg = await Message.create({ from, to, text, attachments });

      const targetSocket = onlineUsers.get(to.toString());
      if (targetSocket) io.to(targetSocket).emit("receive_message", msg);
    } catch (err) {
      console.error("send_message error:", err);
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id);
    for (const [userId, sId] of onlineUsers.entries()) {
      if (sId === socket.id) onlineUsers.delete(userId);
    }
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
