// Generate 6-digit numeric code
const generateCode = () => {
  return String(Math.floor(100000 + Math.random() * 900000)).padStart(6, "0");
};

module.exports = generateCode;
