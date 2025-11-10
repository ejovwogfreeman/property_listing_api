require("dotenv").config({ quiet: true });
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
// const connectDB = require("./config/db");

// const authRoutes = require("./routes/authRoutes");
// const propertyRoutes = require("./routes/propertyRoutes");
// const chatRoutes = require("./routes/chatRoutes");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Connect MongoDB
// connectDB();

// Middleware
app.use(cors());
app.use(express.json());
// app.use("/api/auth", authRoutes);
// app.use("/api/property", propertyRoutes);
// app.use("/api/chat", chatRoutes);
app.get("/", (req, res) => res.json({ msg: "hello" }));

// Global Socket Manager
global.onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log("🟢 New client connected:", socket.id);

  // Track user online status
  socket.on("user_connected", (userId) => {
    onlineUsers.set(userId, socket.id);
    console.log(`✅ User ${userId} connected`);
  });

  // Notify users in real time
  socket.on("notify", (data) => {
    const targetSocket = onlineUsers.get(data.userId);
    if (targetSocket) {
      io.to(targetSocket).emit("notification", data);
    }
  });

  // Chat message broadcasting
  socket.on("send_message", (data) => {
    const receiverSocket = onlineUsers.get(data.receiverId);
    if (receiverSocket) {
      io.to(receiverSocket).emit("receive_message", data);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
    for (const [userId, id] of onlineUsers.entries()) {
      if (id === socket.id) {
        onlineUsers.delete(userId);
      }
    }
  });
});

global.io = io; // make io accessible globally to controllers

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
