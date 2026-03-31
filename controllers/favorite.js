const Favorite = require("../models/favorite");
const Property = require("../models/property");
const Notification = require("../models/notification");

// Add a property to favorites
const addToFavorites = async (req, res) => {
  try {
    const userId = req.user.id;
    const { propertyId } = req.body;

    const property = await Property.findById(propertyId);
    if (!property) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    const existing = await Favorite.findOne({
      user: userId,
      property: propertyId,
    });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Already in favorites" });
    }

    const favorite = await Favorite.create({
      user: userId,
      property: propertyId,
    });

    await Notification.create({
      user: userId,
      title: "Added to Favorites",
      message: `"${property.title}" added to your favorites.`,
      meta: { propertyId },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: "favorite_added",
        title: "Added to Favorites",
        message: `"${property.title}" added to your favorites.`,
        propertyId,
      });
    }

    res.status(201).json({ success: true, favorite });
  } catch (err) {
    console.error("Add to favorites error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Remove a property from favorites
const removeFromFavorites = async (req, res) => {
  try {
    const userId = req.user.id;
    const { propertyId } = req.body;

    const favorite = await Favorite.findOneAndDelete({
      user: userId,
      property: propertyId,
    });
    if (!favorite) {
      return res
        .status(404)
        .json({ success: false, message: "Favorite not found" });
    }

    const property = await Property.findById(propertyId);

    await Notification.create({
      user: userId,
      title: "Removed from Favorites",
      message: `"${property ? property.title : "Property"}" removed from your favorites.`,
      meta: { propertyId },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: "favorite_removed",
        title: "Removed from Favorites",
        message: `"${property ? property.title : "Property"}" removed from your favorites.`,
        propertyId,
      });
    }

    res.json({ success: true, message: "Favorite removed" });
  } catch (err) {
    console.error("Remove from favorites error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Clear all favorites
const clearFavorites = async (req, res) => {
  try {
    const userId = req.user.id;

    await Favorite.deleteMany({ user: userId });

    await Notification.create({
      user: userId,
      title: "Favorites Cleared",
      message: "All items have been removed from your favorites.",
    });

    if (global.io) {
      global.io.emit("notification", {
        type: "favorites_cleared",
        title: "Favorites Cleared",
        message: "All items have been removed from your favorites.",
      });
    }

    res.json({ success: true, message: "Favorites cleared" });
  } catch (err) {
    console.error("Clear favorites error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get all favorites for the logged-in user
const getFavorites = async (req, res) => {
  try {
    const userId = req.user.id;

    const favorites = await Favorite.find({ user: userId }).populate(
      "property",
    );

    res.json({ success: true, favorites });
  } catch (err) {
    console.error("Get favorites error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get a single favorite by favorite ID
const getFavoriteById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const favorite = await Favorite.findOne({ _id: id, user: userId }).populate(
      "property",
    );
    if (!favorite) {
      return res
        .status(404)
        .json({ success: false, message: "Favorite not found" });
    }

    res.json({ success: true, favorite });
  } catch (err) {
    console.error("Get favorite by ID error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  addToFavorites,
  removeFromFavorites,
  clearFavorites,
  getFavorites,
  getFavoriteById,
};
