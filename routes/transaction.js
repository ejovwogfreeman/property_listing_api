const express = require("express");
const router = express.Router();
const {
  walletFunding,
  verifyWalletFunding,
  payAgent,
  changeTransactionStatus,
  getUserTransactions,
  getAgentTransactions,
  getAllTransactions,
} = require("../controllers/transaction");
const { protect, authorize } = require("../middlewares/auth");

// ---------------------------
// Transaction Routes
// ---------------------------

// Fund Wallet
router.post("/fund-wallet", protect, walletFunding);

// Verify Fund Wallet
router.post(
  "/verify-fund-wallet",
  protect,
  authorize("admin"),
  verifyWalletFunding,
);

// Pay Agent
router.post("/pay-agent", protect, authorize("admin"), payAgent);

// Change Transaction Status
router.post(
  "/change-transaction-status",
  protect,
  authorize("admin"),
  getUserTransactions,
);

// Get User Transactions
router.post("/user-transactions", protect, changeTransactionStatus);

// Get Agent Transactions
router.post(
  "/agent-transactions",
  protect,
  authorize("admin"),
  getAgentTransactions,
);

// Get All Transactions
router.post(
  "/all-transactions",
  protect,
  authorize("admin"),
  getAllTransactions,
);

module.exports = router;
