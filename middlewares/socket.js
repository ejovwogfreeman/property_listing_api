// // socket.js
// const Notification = require("../models/notification");
// const Message = require("../models/message");

// /**
//  * Initialize Socket.IO
//  * @param {Server} io - socket.io server instance
//  * @param {Map} onlineUsers - global online users map
//  */
// const socketHandler = (io, onlineUsers) => {
//   io.on("connection", (socket) => {
//     console.log("🟢 New socket connected:", socket.id);

//     // ------------------------
//     // Register user online
//     // ------------------------
//     socket.on("user_connected", (userId) => {
//       if (userId) {
//         onlineUsers.set(userId.toString(), socket.id);
//         console.log(`✅ User ${userId} connected via socket ${socket.id}`);
//       }
//     });

//     // ------------------------
//     // Send notification to a specific user
//     // ------------------------
//     socket.on("notify", async (data) => {
//       try {
//         const { userId, title, message, meta } = data || {};
//         if (!userId) return;

//         console.log("📨 Notification received for user:", {
//           userId,
//           title,
//           message,
//           meta,
//         });

//         // Persist notification in DB
//         const notif = await Notification.create({
//           user: userId,
//           title,
//           message,
//           meta,
//         });

//         // Emit real-time if online
//         const targetSocket = onlineUsers.get(userId.toString());
//         if (targetSocket) {
//           io.to(targetSocket).emit("notification", notif);
//           console.log(`✅ Notification sent to online user (${userId})`);
//         } else {
//           console.log(
//             `🕓 User (${userId}) is offline. Notification stored only.`,
//           );
//         }
//       } catch (err) {
//         console.error("❌ notify error:", err);
//       }
//     });

//     // ------------------------
//     // Chat: send message and persist
//     // ------------------------
//     socket.on("user_connected", (userId) => {
//       if (userId) {
//         // 1. Join a room named after the user ID (supports multi-tab/multi-device)
//         socket.join(userId.toString());

//         // Track online users if you are using a Map
//         if (global.onlineUsers) {
//           global.onlineUsers.set(userId.toString(), socket.id);
//         }
//       }
//     });

//     socket.on("send_message", async (payload) => {
//       try {
//         const { from, to, text, attachments } = payload;
//         if (!from || !to) return;

//         const msg = await Message.create({ from, to, text, attachments });

//         const targetSocket = onlineUsers.get(to.toString());
//         if (targetSocket) io.to(targetSocket).emit("receive_message", msg);
//       } catch (err) {
//         console.error("send_message error:", err);
//       }
//     });

//     // ------------------------
//     // Disconnect
//     // ------------------------
//     socket.on("disconnect", () => {
//       console.log("🔴 Socket disconnected:", socket.id);
//       for (const [userId, sId] of onlineUsers.entries()) {
//         if (sId === socket.id) onlineUsers.delete(userId);
//       }
//     });
//   });
// };

// module.exports = socketHandler;

// socket.js
const Notification = require("../models/notification");
// const Message = require("../models/message");

/**
 * Initialize Socket.IO
 * @param {Server} io - socket.io server instance
 * @param {Map} onlineUsers - global online users map
 */
const socketHandler = (io, onlineUsers) => {
  io.on("connection", (socket) => {
    console.log("🟢 New socket connected:", socket.id);

    // ------------------------
    // Register user online & join user room
    // ------------------------
    socket.on("user_connected", (userId) => {
      if (userId) {
        const userIdStr = userId.toString();

        // 1. Join a room named after the user ID (supports multi-tab/multi-device)
        socket.join(userIdStr);

        // 2. Track online users map
        if (onlineUsers) {
          onlineUsers.set(userIdStr, socket.id);
        }

        console.log(
          `✅ User ${userIdStr} connected and joined room via socket ${socket.id}`,
        );
      }
    });

    // ------------------------
    // Send notification to a specific user
    // ------------------------
    socket.on("notify", async (data) => {
      try {
        const { userId, title, message, meta } = data || {};
        if (!userId) return;

        console.log("📨 Notification received for user:", {
          userId,
          title,
          message,
          meta,
        });

        // Persist notification in DB
        const notif = await Notification.create({
          user: userId,
          title,
          message,
          meta,
        });

        // Emit real-time if online (via user room or direct socket)
        const userIdStr = userId.toString();
        const targetSocket = onlineUsers.get(userIdStr);

        if (targetSocket) {
          io.to(targetSocket).emit("notification", notif);
          console.log(`✅ Notification sent to online user (${userIdStr})`);
        } else {
          console.log(
            `🕓 User (${userIdStr}) is offline. Notification stored only.`,
          );
        }
      } catch (err) {
        console.error("❌ notify error:", err);
      }
    });

    // ------------------------
    // Disconnect
    // ------------------------
    socket.on("disconnect", () => {
      console.log("🔴 Socket disconnected:", socket.id);
      for (const [userId, sId] of onlineUsers.entries()) {
        if (sId === socket.id) {
          onlineUsers.delete(userId);
        }
      }
    });
  });
};

module.exports = socketHandler;
