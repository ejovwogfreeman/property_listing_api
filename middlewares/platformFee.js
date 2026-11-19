// The platform's fee on a property sale or rental. It's added on top of the
// buyer's payment and kept from the agent's payout. Always worked out here,
// never taken from the request body.
const calculatePlatformFee = (price, listingType) => {
  const amount = Number(price) || 0;
  if (amount <= 0) return 0;

  if (listingType === "sale") {
    // 1% under ₦200m, 0.75% at or above ₦200m
    const rate = amount >= 200_000_000 ? 0.0075 : 0.01;
    return Math.round(amount * rate);
  }

  // rent: flat ₦5,000 between ₦200k and ₦400k, otherwise 2%
  if (amount >= 200_000 && amount <= 400_000) return 5_000;
  return Math.round(amount * 0.02);
};

// The buyer's processing fee when a payment is refunded or cancelled,
// taken off the amount sent back (section 6). Never more than the amount.
//   under ₦100,000          → ₦2,000
//   ₦100,000 to ₦1,000,000  → ₦5,000
//   over ₦1,000,000         → ₦10,000
const calculateRefundFee = (amountPaid) => {
  const amount = Number(amountPaid) || 0;
  if (amount <= 0) return 0;
  const fee = amount < 100_000 ? 2_000 : amount <= 1_000_000 ? 5_000 : 10_000;
  return Math.min(fee, amount);
};

module.exports = { calculatePlatformFee, calculateRefundFee };
