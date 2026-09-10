const User = require("../models/user");
const Notification = require("../models/notification");
const Transaction = require("../models/transaction");
const Inspection = require("../models/inspection");
const Purchase = require("../models/purchase");
const Escrow = require("../models/escrow");
const {
  initializeTransaction,
  verifyTransaction,
} = require("../middlewares/paystack");
const crypto = require("crypto");

// ---------------------------
// Wallet Funding
// ---------------------------
const walletFunding = async (req, res) => {
  try {
    const { amount, callback_url } = req.body;
    const userId = req.user._id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    // 🔑 Generate unique reference
    const reference = crypto.randomBytes(16).toString("hex");

    // 🧾 Create pending transaction
    const transaction = await Transaction.create({
      from: userId, // user is paying
      to: userId, // wallet funding goes back to same user
      amount,
      type: "wallet_funding",
      status: "pending",
      reference,
    });

    // 🔔 Notify user
    await Notification.create({
      user: userId,
      title: "Wallet Funding Started",
      message: `You initiated a wallet funding of ₦${amount}.`,
      meta: { transactionId: transaction._id },
    });

    // 🔌 Socket event
    if (global.io) {
      global.io.emit("notification", {
        type: "wallet_funding_started",
        title: "Wallet Funding",
        message: `A user started wallet funding.`,
        transactionId: transaction._id,
      });
    }

    // 💳 Initialize Paystack
    const init = await initializeTransaction(
      req.user.email,
      amount * 100,
      reference,
      callback_url,
    );

    return res.json({
      success: true,
      authorizationUrl: init.data.authorization_url,
      reference,
      transactionId: transaction._id,
      callback_url,
    });
  } catch (err) {
    console.error("walletFunding error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// Verify Wallet Funding
// ---------------------------
const verifyWalletFunding = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ message: "Reference is required" });
    }

    // 🔍 Verify with Paystack
    const verification = await verifyTransaction(reference);

    if (verification.data.status !== "success") {
      return res.status(400).json({ message: "Payment not successful" });
    }

    // 🧾 Find transaction
    const transaction = await Transaction.findOne({ reference });

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    // 🔒 Ensure correct type
    if (transaction.type !== "wallet_funding") {
      return res.status(400).json({
        message: "Invalid transaction type",
      });
    }

    // 🚫 Prevent double processing
    if (transaction.status === "approved") {
      return res.status(400).json({
        message: "Transaction already verified",
      });
    }

    // 👤 Find user (from field is now correct source of truth)
    const user = await User.findById(transaction.from);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 💰 Credit wallet
    user.balance += transaction.amount;
    await user.save();

    // 📊 Update transaction
    transaction.status = "approved";
    transaction.approvedAt = new Date();
    await transaction.save();

    // 🔔 Notify user
    await Notification.create({
      user: user._id,
      title: "Wallet Funded",
      message: `₦${transaction.amount} has been added to your wallet successfully.`,
      meta: { transactionId: transaction._id },
    });

    // 🔌 Socket event
    if (global.io) {
      global.io.emit("notification", {
        type: "wallet_funded",
        title: "Wallet Credited",
        message: `A wallet has been credited successfully.`,
        transactionId: transaction._id,
      });
    }

    return res.json({
      success: true,
      message: "Wallet funded successfully",
      balance: user.balance,
      transaction,
    });
  } catch (err) {
    console.error("verifyWalletFunding error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const payAgent = async (req, res) => {
  try {
    const { agentId, amount } = req.body;
    const adminId = req.user._id;

    if (!agentId || !amount || amount <= 0) {
      return res.status(400).json({
        message: "Agent and valid amount are required",
      });
    }

    // 👤 Find agent
    const agent = await User.findById(agentId);

    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    // 🔑 Generate reference
    const reference = crypto.randomBytes(16).toString("hex");

    // 🧾 Create transaction record
    const transaction = await Transaction.create({
      from: adminId,
      to: agentId,
      amount,
      type: "agent_payment",
      status: "approved", // internal transfer, no Paystack needed
      reference,
      approvedAt: new Date(),
    });

    // 💰 Credit agent wallet
    agent.balance += amount;
    await agent.save();

    // 🔔 Notify agent
    await Notification.create({
      user: agentId,
      title: "You received a payment",
      message: `You have been paid ₦${amount} by admin.`,
      meta: { transactionId: transaction._id },
    });

    // 🔌 Socket event
    if (global.io) {
      global.io.emit("notification", {
        type: "agent_payment",
        title: "Agent Paid",
        message: `An agent has been paid successfully.`,
        transactionId: transaction._id,
      });
    }

    return res.json({
      success: true,
      message: "Agent paid successfully",
      transaction,
      balance: agent.balance,
    });
  } catch (err) {
    console.error("payAgent error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const changeTransactionStatus = async (req, res) => {
  try {
    const { transactionId, status } = req.body;

    const transaction = await Transaction.findById(transactionId);

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }
    s;
    if (!["pending", "approved", "failed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const user = await User.findById(transaction.to || transaction.from);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const previousStatus = transaction.status;

    // ===============================
    // 🔁 APPROVED → PENDING / FAILED (REVERSE MONEY)
    // ===============================
    if (
      previousStatus === "approved" &&
      (status === "pending" || status === "failed")
    ) {
      if (transaction.type === "wallet_funding") {
        user.balance -= transaction.amount;
      }

      if (transaction.type === "agent_payment") {
        user.balance -= transaction.amount;
      }

      if (transaction.type === "withdrawal") {
        user.balance -= transaction.amount;
      }

      await user.save();
    }

    // ===============================
    // ➕ PENDING → APPROVED (APPLY MONEY)
    // ===============================
    if (previousStatus === "pending" && status === "approved") {
      if (transaction.type === "wallet_funding") {
        user.balance += transaction.amount;
      }

      if (transaction.type === "agent_payment") {
        user.balance += transaction.amount;
      }

      await user.save();
      transaction.approvedAt = new Date();
    }

    // ===============================
    // UPDATE TRANSACTION STATUS
    // ===============================
    transaction.status = status;
    await transaction.save();

    return res.json({
      success: true,
      message: `Transaction updated to ${status}`,
      transaction,
      balance: user.balance,
    });
  } catch (err) {
    console.error("changeTransactionStatus error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// const getUserTransactions = async (req, res) => {
//   try {
//     const userId = req.user._id;

//     const transactions = await Transaction.find({
//       $or: [{ from: userId }, { to: userId }],
//     })
//       .populate("from", "name email")
//       .populate("to", "name email")
//       .sort({ createdAt: -1 });

//     return res.json({
//       success: true,
//       count: transactions.length,
//       transactions,
//     });
//   } catch (err) {
//     console.error("getUserTransactions error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// const getUserTransactions = async (req, res) => {
//   try {
//     const userId = req.user._id;

//     // Fetch all related records in parallel using .lean() for performance
//     const [transactions, inspections, purchases, escrows] = await Promise.all([
//       Transaction.find({
//         $or: [{ from: userId }, { to: userId }],
//       })
//         .populate("from", "name email")
//         .populate("to", "name email")
//         .lean(),

//       Inspection.find({ user: userId })
//         .populate("property", "title price address")
//         .populate("user", "name email")
//         .populate("owner", "name email")
//         .lean(),

//       Purchase.find({ buyer: userId })
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),

//       Escrow.find({ buyer: userId })
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),
//     ]);

//     // Tag each item with a recordType
//     const taggedTransactions = transactions.map((item) => ({
//       ...item,
//       recordType: "transaction",
//     }));
//     const taggedInspections = inspections.map((item) => ({
//       ...item,
//       recordType: "inspection",
//     }));
//     const taggedPurchases = purchases.map((item) => ({
//       ...item,
//       recordType: "purchase",
//     }));
//     const taggedEscrows = escrows.map((item) => ({
//       ...item,
//       recordType: "escrow",
//     }));

//     // Combine all arrays into one single list
//     const allActivities = [
//       ...taggedTransactions,
//       ...taggedInspections,
//       ...taggedPurchases,
//       ...taggedEscrows,
//     ];

//     // Sort everything globally by createdAt descending (newest first)
//     allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

//     return res.json({
//       success: true,
//       count: allActivities.length,
//       activities: allActivities,
//     });
//   } catch (err) {
//     console.error("getUserTransactions error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// const getAgentTransactions = async (req, res) => {
//   try {
//     const agentId = req.params.agentId || req.user._id;

//     const transactions = await Transaction.find({
//       to: agentId,
//       type: "agent_payment",
//     })
//       .populate("from", "name email")
//       .populate("to", "name email")
//       .sort({ createdAt: -1 });

//     return res.json({
//       success: true,
//       count: transactions.length,
//       totalEarned: transactions.reduce((sum, t) => sum + t.amount, 0),
//       transactions,
//     });
//   } catch (err) {
//     console.error("getAgentTransactions error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// const getAgentTransactions = async (req, res) => {
//   try {
//     const agentId = req.params.agentId || req.user._id;

//     // Fetch all related records in parallel using .lean() for performance
//     const [transactions, inspections, purchases, escrows] = await Promise.all([
//       Transaction.find({
//         $or: [{ to: agentId }, { from: agentId }],
//       })
//         .populate("from", "name email")
//         .populate("to", "name email")
//         .lean(),

//       Inspection.find({ owner: agentId })
//         .populate("property", "title price address")
//         .populate("user", "name email")
//         .populate("owner", "name email")
//         .lean(),

//       Purchase.find({ seller: agentId })
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),

//       Escrow.find({ seller: agentId })
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),
//     ]);

//     // Tag each item with a recordType
//     const taggedTransactions = transactions.map((item) => ({
//       ...item,
//       recordType: "transaction",
//     }));
//     const taggedInspections = inspections.map((item) => ({
//       ...item,
//       recordType: "inspection",
//     }));
//     const taggedPurchases = purchases.map((item) => ({
//       ...item,
//       recordType: "purchase",
//     }));
//     const taggedEscrows = escrows.map((item) => ({
//       ...item,
//       recordType: "escrow",
//     }));

//     // Combine all arrays into one single list
//     const allActivities = [
//       ...taggedTransactions,
//       ...taggedInspections,
//       ...taggedPurchases,
//       ...taggedEscrows,
//     ];

//     // Sort everything globally by createdAt descending (newest first)
//     allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

//     // Calculate total earned from agent payment transactions (or adjust logic as needed)
//     const agentPayments = transactions.filter(
//       (t) =>
//         t.to?.toString() === agentId.toString() && t.type === "agent_payment",
//     );
//     const totalEarned = agentPayments.reduce(
//       (sum, t) => sum + (t.amount || 0),
//       0,
//     );

//     return res.json({
//       success: true,
//       count: allActivities.length,
//       totalEarned,
//       activities: allActivities,
//     });
//   } catch (err) {
//     console.error("getAgentTransactions error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// const getAllTransactions = async (req, res) => {
//   try {
//     const transactions = await Transaction.find()
//       .populate("from", "name email")
//       .populate("to", "name email")
//       .sort({ createdAt: -1 });

//     return res.json({
//       success: true,
//       count: transactions.length,
//       transactions,
//     });
//   } catch (err) {
//     console.error("getAllTransactions error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// 📊 Get All Platform Activities (Mixed & Sorted)
// ---------------------------
// const getAllTransactions = async (req, res) => {
//   try {
//     // Fetch all records in parallel using .lean() for performance
//     const [transactions, inspections, purchases, escrows] = await Promise.all([
//       Transaction.find()
//         .populate("from", "name email")
//         .populate("to", "name email")
//         .lean(),

//       Inspection.find()
//         .populate("property", "title price address")
//         .populate("user", "name email")
//         .populate("owner", "name email")
//         .lean(),

//       Purchase.find()
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),

//       Escrow.find()
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),
//     ]);

//     // Tag each item with a recordType for frontend differentiation
//     const taggedTransactions = transactions.map((item) => ({
//       ...item,
//       recordType: "transaction",
//     }));
//     const taggedInspections = inspections.map((item) => ({
//       ...item,
//       recordType: "inspection",
//     }));
//     const taggedPurchases = purchases.map((item) => ({
//       ...item,
//       recordType: "purchase",
//     }));
//     const taggedEscrows = escrows.map((item) => ({
//       ...item,
//       recordType: "escrow",
//     }));

//     // Combine all arrays into one single list
//     const allActivities = [
//       ...taggedTransactions,
//       ...taggedInspections,
//       ...taggedPurchases,
//       ...taggedEscrows,
//     ];

//     // Sort everything globally by createdAt descending (newest first)
//     allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

//     return res.json({
//       success: true,
//       count: allActivities.length,
//       activities: allActivities,
//     });
//   } catch (err) {
//     console.error("getAllTransactions error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// const getUserTransactionsAndEscrows = async (req, res) => {
//   try {
//     const userId = req.user._id;

//     // Fetch transactions and escrows in parallel
//     const [transactions, escrows] = await Promise.all([
//       Transaction.find({
//         $or: [{ from: userId }, { to: userId }],
//       })
//         .populate("from", "name email")
//         .populate("to", "name email")
//         .lean(),

//       Escrow.find({ buyer: userId })
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),
//     ]);

//     // Tag records
//     const taggedTransactions = transactions.map((item) => ({
//       ...item,
//       recordType: "transaction",
//     }));
//     const taggedEscrows = escrows.map((item) => ({
//       ...item,
//       recordType: "escrow",
//     }));

//     // Combine and sort by newest first
//     const allActivities = [...taggedTransactions, ...taggedEscrows];
//     allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

//     return res.json({
//       success: true,
//       count: allActivities.length,
//       activities: allActivities,
//     });
//   } catch (err) {
//     console.error("getUserTransactionsAndEscrows error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// const getUserPurchasesAndInspections = async (req, res) => {
//   try {
//     const userId = req.user._id;

//     // Fetch purchases and inspections in parallel
//     const [purchases, inspections] = await Promise.all([
//       Purchase.find({ buyer: userId })
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),

//       Inspection.find({ user: userId })
//         .populate("property", "title price address")
//         .populate("user", "name email")
//         .populate("owner", "name email")
//         .lean(),
//     ]);

//     // Tag records
//     const taggedPurchases = purchases.map((item) => ({
//       ...item,
//       recordType: "purchase",
//     }));
//     const taggedInspections = inspections.map((item) => ({
//       ...item,
//       recordType: "inspection",
//     }));

//     // Combine and sort by newest first
//     const allActivities = [...taggedPurchases, ...taggedInspections];
//     allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

//     return res.json({
//       success: true,
//       count: allActivities.length,
//       activities: allActivities,
//     });
//   } catch (err) {
//     console.error("getUserPurchasesAndInspections error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// const getAgentTransactionsAndEscrows = async (req, res) => {
//   try {
//     const agentId = req.params.agentId || req.user._id;

//     // Fetch transactions and escrows in parallel using .lean()
//     const [transactions, escrows] = await Promise.all([
//       Transaction.find({
//         $or: [{ to: agentId }, { from: agentId }],
//       })
//         .populate("from", "name email")
//         .populate("to", "name email")
//         .lean(),

//       Escrow.find({ seller: agentId })
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),
//     ]);

//     // Tag records
//     const taggedTransactions = transactions.map((item) => ({
//       ...item,
//       recordType: "transaction",
//     }));
//     const taggedEscrows = escrows.map((item) => ({
//       ...item,
//       recordType: "escrow",
//     }));

//     // Combine and sort by newest first
//     const allActivities = [...taggedTransactions, ...taggedEscrows];
//     allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

//     // Calculate total earned from agent payment transactions
//     const agentPayments = transactions.filter(
//       (t) =>
//         t.to?.toString() === agentId.toString() && t.type === "agent_payment",
//     );
//     const totalEarned = agentPayments.reduce(
//       (sum, t) => sum + (t.amount || 0),
//       0,
//     );

//     return res.json({
//       success: true,
//       count: allActivities.length,
//       totalEarned,
//       activities: allActivities,
//     });
//   } catch (err) {
//     console.error("getAgentTransactionsAndEscrows error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// const getAgentPurchasesAndInspections = async (req, res) => {
//   try {
//     const agentId = req.params.agentId || req.user._id;

//     // Fetch purchases and inspections in parallel using .lean()
//     const [purchases, inspections] = await Promise.all([
//       Purchase.find({ seller: agentId })
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),

//       Inspection.find({ owner: agentId })
//         .populate("property", "title price address")
//         .populate("user", "name email")
//         .populate("owner", "name email")
//         .lean(),
//     ]);

//     // Tag records
//     const taggedPurchases = purchases.map((item) => ({
//       ...item,
//       recordType: "purchase",
//     }));
//     const taggedInspections = inspections.map((item) => ({
//       ...item,
//       recordType: "inspection",
//     }));

//     // Combine and sort by newest first
//     const allActivities = [...taggedPurchases, ...taggedInspections];
//     allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

//     return res.json({
//       success: true,
//       count: allActivities.length,
//       activities: allActivities,
//     });
//   } catch (err) {
//     console.error("getAgentPurchasesAndInspections error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// const getAllTransactionsAndEscrows = async (req, res) => {
//   try {
//     // Fetch transactions and escrows in parallel using .lean()
//     const [transactions, escrows] = await Promise.all([
//       Transaction.find()
//         .populate("from", "name email")
//         .populate("to", "name email")
//         .lean(),

//       Escrow.find()
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),
//     ]);

//     // Tag records
//     const taggedTransactions = transactions.map((item) => ({
//       ...item,
//       recordType: "transaction",
//     }));
//     const taggedEscrows = escrows.map((item) => ({
//       ...item,
//       recordType: "escrow",
//     }));

//     // Combine and sort by newest first
//     const allActivities = [...taggedTransactions, ...taggedEscrows];
//     allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

//     return res.json({
//       success: true,
//       count: allActivities.length,
//       activities: allActivities,
//     });
//   } catch (err) {
//     console.error("getAllTransactionsAndEscrows error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// const getAllPurchasesAndInspections = async (req, res) => {
//   try {
//     // Fetch purchases and inspections in parallel using .lean()
//     const [purchases, inspections] = await Promise.all([
//       Purchase.find()
//         .populate("property", "title price address")
//         .populate("buyer", "name email")
//         .populate("seller", "name email")
//         .lean(),

//       Inspection.find()
//         .populate("property", "title price address")
//         .populate("user", "name email")
//         .populate("owner", "name email")
//         .lean(),
//     ]);

//     // Tag records
//     const taggedPurchases = purchases.map((item) => ({
//       ...item,
//       recordType: "purchase",
//     }));
//     const taggedInspections = inspections.map((item) => ({
//       ...item,
//       recordType: "inspection",
//     }));

//     // Combine and sort by newest first
//     const allActivities = [...taggedPurchases, ...taggedInspections];
//     allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

//     return res.json({
//       success: true,
//       count: allActivities.length,
//       activities: allActivities,
//     });
//   } catch (err) {
//     console.error("getAllPurchasesAndInspections error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// Helper function to attach the first property image
const attachFirstPropertyImage = (item) => {
  if (item.property) {
    item.property.image =
      item.property.images && item.property.images.length > 0
        ? item.property.images[0]
        : null;
  }
  return item;
};

const getUserTransactionsAndEscrows = async (req, res) => {
  try {
    const userId = req.user._id;

    const [transactions, escrows] = await Promise.all([
      Transaction.find({
        $or: [{ from: userId }, { to: userId }],
      })
        .populate("from", "name email")
        .populate("to", "name email")
        .lean(),

      Escrow.find({ buyer: userId })
        .populate("property", "title price address images")
        .populate("buyer", "name email")
        .populate("seller", "name email")
        .lean(),
    ]);

    const taggedTransactions = transactions.map((item) => ({
      ...item,
      recordType: "transaction",
    }));
    const taggedEscrows = escrows.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "escrow" };
    });

    const allActivities = [...taggedTransactions, ...taggedEscrows];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      success: true,
      count: allActivities.length,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getUserTransactionsAndEscrows error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getUserPurchasesAndInspections = async (req, res) => {
  try {
    const userId = req.user._id;

    const [purchases, inspections] = await Promise.all([
      Purchase.find({ buyer: userId })
        .populate("property", "title price address images")
        .populate("buyer", "name email")
        .populate("seller", "name email")
        .lean(),

      Inspection.find({ user: userId })
        .populate("property", "title price address images")
        .populate("user", "name email")
        .populate("owner", "name email")
        .lean(),
    ]);

    const taggedPurchases = purchases.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "purchase" };
    });
    const taggedInspections = inspections.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "inspection" };
    });

    const allActivities = [...taggedPurchases, ...taggedInspections];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      success: true,
      count: allActivities.length,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getUserPurchasesAndInspections error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAgentTransactionsAndEscrows = async (req, res) => {
  try {
    const agentId = req.params.agentId || req.user._id;

    const [transactions, escrows] = await Promise.all([
      Transaction.find({
        $or: [{ to: agentId }, { from: agentId }],
      })
        .populate("from", "name email")
        .populate("to", "name email")
        .lean(),

      Escrow.find({ seller: agentId })
        .populate("property", "title price address images")
        .populate("buyer", "name email")
        .populate("seller", "name email")
        .lean(),
    ]);

    const taggedTransactions = transactions.map((item) => ({
      ...item,
      recordType: "transaction",
    }));
    const taggedEscrows = escrows.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "escrow" };
    });

    const allActivities = [...taggedTransactions, ...taggedEscrows];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const agentPayments = transactions.filter(
      (t) =>
        t.to?.toString() === agentId.toString() && t.type === "agent_payment",
    );
    const totalEarned = agentPayments.reduce(
      (sum, t) => sum + (t.amount || 0),
      0,
    );

    return res.json({
      success: true,
      count: allActivities.length,
      totalEarned,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getAgentTransactionsAndEscrows error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAgentPurchasesAndInspections = async (req, res) => {
  try {
    const agentId = req.params.agentId || req.user._id;

    const [purchases, inspections] = await Promise.all([
      Purchase.find({ seller: agentId })
        .populate("property", "title price address images")
        .populate("buyer", "name email")
        .populate("seller", "name email")
        .lean(),

      Inspection.find({ owner: agentId })
        .populate("property", "title price address images")
        .populate("user", "name email")
        .populate("owner", "name email")
        .lean(),
    ]);

    const taggedPurchases = purchases.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "purchase" };
    });
    const taggedInspections = inspections.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "inspection" };
    });

    const allActivities = [...taggedPurchases, ...taggedInspections];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      success: true,
      count: allActivities.length,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getAgentPurchasesAndInspections error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAllTransactionsAndEscrows = async (req, res) => {
  try {
    const [transactions, escrows] = await Promise.all([
      Transaction.find()
        .populate("from", "name email")
        .populate("to", "name email")
        .lean(),

      Escrow.find()
        .populate("property", "title price address images")
        .populate("buyer", "name email")
        .populate("seller", "name email")
        .lean(),
    ]);

    const taggedTransactions = transactions.map((item) => ({
      ...item,
      recordType: "transaction",
    }));
    const taggedEscrows = escrows.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "escrow" };
    });

    const allActivities = [...taggedTransactions, ...taggedEscrows];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      success: true,
      count: allActivities.length,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getAllTransactionsAndEscrows error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAllPurchasesAndInspections = async (req, res) => {
  try {
    const [purchases, inspections] = await Promise.all([
      Purchase.find()
        .populate("property", "title price address images")
        .populate("buyer", "name email")
        .populate("seller", "name email")
        .lean(),

      Inspection.find()
        .populate("property", "title price address images")
        .populate("user", "name email")
        .populate("owner", "name email")
        .lean(),
    ]);

    const taggedPurchases = purchases.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "purchase" };
    });
    const taggedInspections = inspections.map((item) => {
      attachFirstPropertyImage(item);
      return { ...item, recordType: "inspection" };
    });

    const allActivities = [...taggedPurchases, ...taggedInspections];
    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      success: true,
      count: allActivities.length,
      activities: allActivities,
    });
  } catch (err) {
    console.error("getAllPurchasesAndInspections error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// Request Agent Withdrawal
// ---------------------------
const requestWithdrawal = async (req, res) => {
  try {
    const { amount, bankId } = req.body;
    const userId = req.user._id;

    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid withdrawal amount" });
    }

    if (!bankId) {
      return res.status(400).json({
        success: false,
        message: "Destination bank account is required",
      });
    }

    // 👤 Verify user is an agent
    const user = await User.findById(userId);
    if (!user || user.role !== "agent") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only agents can request withdrawals.",
      });
    }

    // 💰 Check if agent has enough balance
    if (user.balance < amount) {
      return res
        .status(400)
        .json({ success: false, message: "Insufficient wallet balance" });
    }

    // 🔑 Generate unique reference
    const reference = crypto.randomBytes(16).toString("hex");

    // 🧾 Create pending withdrawal transaction
    const transaction = await Transaction.create({
      from: userId,
      to: userId,
      amount,
      type: "withdrawal",
      status: "pending",
      reference,
      meta: { bankId },
    });

    // 💸 Deduct from agent wallet immediately
    user.balance -= amount;
    await user.save();

    // 🔔 Notify user
    await Notification.create({
      user: userId,
      title: "Withdrawal Requested",
      message: `Your withdrawal request of ₦${amount} has been submitted and is pending review.`,
      meta: { transactionId: transaction._id },
    });

    // 🔌 Socket event
    if (global.io) {
      global.io.emit("notification", {
        type: "withdrawal_requested",
        title: "New Withdrawal Request",
        message: `An agent requested a withdrawal of ₦${amount}.`,
        transactionId: transaction._id,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Withdrawal request submitted successfully",
      balance: user.balance,
      transaction,
    });
  } catch (err) {
    console.error("requestWithdrawal error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  walletFunding,
  verifyWalletFunding,
  payAgent,
  changeTransactionStatus,
  getUserTransactionsAndEscrows,
  getAgentTransactionsAndEscrows,
  getAllTransactionsAndEscrows,
  getUserPurchasesAndInspections,
  getAgentPurchasesAndInspections,
  getAllPurchasesAndInspections,
  requestWithdrawal,
};
