const Property = require("../models/property");
const Notification = require("../models/notification");
const { uploadImages, uploadVideos } = require("../middlewares/cloudinary");

/**
 * @desc Create a new property
 */

const createProperty = async (req, res) => {
  try {
    const { title, description, price, address } = req.body;
    const owner = req.user._id;

    // Upload images (multiple)
    const images = req.files?.images
      ? await uploadImages(req.files.images)
      : [];

    // Upload video (single)
    const videoUrls = req.files?.video
      ? await uploadVideos(req.files.video)
      : [];
    const video = videoUrls[0] || null;

    // Create property
    const prop = await Property.create({
      title,
      description,
      price,
      address,
      images,
      video,
      owner,
    });

    // Create notification
    await Notification.create({
      user: owner,
      title: "Property Created",
      message: `Your property "${title}" was created successfully.`,
      meta: { propertyId: prop._id },
    });

    // Broadcast
    if (global.io)
      global.io.emit("notification", {
        type: "property_created",
        title: "New Property Listed",
        message: `New property "${title}" just got listed.`,
        propertyId: prop._id,
      });

    res.status(201).json({ success: true, property: prop });
  } catch (err) {
    console.error("createProperty error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Get all properties
 */
listProperties = async (req, res) => {
  try {
    const props = await Property.find().populate("owner", "name email role");
    res.json({ success: true, properties: props });
  } catch (err) {
    console.error("listProperties error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Get single property
 */
getProperty = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id).populate(
      "owner",
      "name email"
    );
    if (!prop)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    // Notify owner that their property was viewed (optional)
    await Notification.create({
      user: prop.owner._id,
      title: "Property Viewed",
      message: `Your property "${prop.title}" was viewed.`,
      meta: { propertyId: prop._id },
    });

    if (global.io)
      global.io.emit("notification", {
        type: "property_viewed",
        title: "Property Viewed",
        message: `Someone viewed "${prop.title}".`,
        propertyId: prop._id,
      });

    res.json({ success: true, property: prop });
  } catch (err) {
    console.error("getProperty error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Update property
 */
updateProperty = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id);
    if (!prop)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    // Check ownership or admin role
    if (
      prop.owner.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    const { title, description, price, address } = req.body;
    if (title) prop.title = title;
    if (description) prop.description = description;
    if (price) prop.price = price;
    if (address) prop.address = address;

    // handle new uploads
    if (req.files && req.files["images"]) {
      const images = req.files["images"].map(
        (f) => f.path || f.url || f.secure_url || f.location || ""
      );
      prop.images.push(...images);
    }

    if (req.files && req.files["video"] && req.files["video"][0]) {
      const v = req.files["video"][0];
      prop.video = v.path || v.url || v.secure_url || v.location || prop.video;
    }

    await prop.save();

    // Notify owner
    await Notification.create({
      user: prop.owner,
      title: "Property Updated",
      message: `Your property "${prop.title}" was updated.`,
      meta: { propertyId: prop._id },
    });

    if (global.io)
      global.io.emit("notification", {
        type: "property_updated",
        title: "Property Updated",
        message: `Property "${prop.title}" was updated.`,
        propertyId: prop._id,
      });

    res.json({ success: true, property: prop });
  } catch (err) {
    console.error("updateProperty error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Delete property
 */
deleteProperty = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id);
    if (!prop)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    // Check ownership or admin role
    if (
      prop.owner.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    await prop.deleteOne();

    // Notify owner
    await Notification.create({
      user: prop.owner,
      title: "Property Deleted",
      message: `Your property "${prop.title}" was deleted.`,
      meta: { propertyId: prop._id },
    });

    if (global.io)
      global.io.emit("notification", {
        type: "property_deleted",
        title: "Property Deleted",
        message: `Property "${prop.title}" has been deleted.`,
        propertyId: prop._id,
      });

    res.json({ success: true, message: "Property deleted successfully" });
  } catch (err) {
    console.error("deleteProperty error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  createProperty,
  listProperties,
  getProperty,
  updateProperty,
  deleteProperty,
};
