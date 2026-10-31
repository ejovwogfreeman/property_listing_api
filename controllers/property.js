const Property = require("../models/property");
const Notification = require("../models/notification");
const { uploadImages, uploadVideos } = require("../middlewares/cloudinary");

/**
 * @desc Create a new property
 */

// const createProperty = async (req, res) => {
//   try {
//     const {
//       title,
//       description,
//       price,
//       escrowFee,
//       address,
//       propertyType,
//       listingType,
//       landSize, // for land only
//       landUnit, // for land only
//       landCondition, // for land only
//       landDocTitle, // for land only
//       landType, //for land only
//       bedroom, // for apartment/house only
//       bathroom, // for apartment/house only
//       kitchen, // for apartment/house only
//       inspectionFee,
//       serviceCharge,
//       nearbyPlaces, // array of strings
//     } = req.body;

//     const user = req.user; // Logged in user
//     const owner = {
//       _id: user._id,
//       name: user.name,
//       profilePicture: user.profilePicture || null,
//       isVerified: user.isVerified || false,
//       rating: user.rating || 0,
//       totalListings: user.totalListings || 0,
//     };

//     // Upload images (multiple)
//     const images = req.files?.images
//       ? await uploadImages(req.files.images)
//       : [];

//     // Upload land document (multiple)
//     const legalDocuments = req.files?.legalDocuments
//       ? await uploadImages(req.files.legalDocuments)
//       : [];

//     // Upload video (single)
//     const videos = req.files?.videos
//       ? await uploadVideos(req.files.videos)
//       : [];
//     // const video = videoUrls[0] || null;

//     // Create property
//     const prop = await Property.create({
//       title,
//       description,
//       price,
//       escrowFee,
//       address,
//       propertyType,
//       listingType,
//       landSize: propertyType === "land" ? landSize : null,
//       landUnit: propertyType === "land" ? landUnit : null,
//       landCondition: propertyType === "land" ? landCondition : null,
//       landDocTitle: propertyType === "land" ? landDocTitle : null,
//       landType: propertyType === "land" ? landType : null,
//       legalDocuments: legalDocuments,
//       bedroom: propertyType !== "land" ? bedroom : null,
//       bathroom: propertyType !== "land" ? bathroom : null,
//       kitchen: propertyType !== "land" ? kitchen : null,
//       inspectionFee,
//       serviceCharge,
//       nearbyPlaces: nearbyPlaces || [],
//       images,
//       videos,
//       owner,
//     });

//     // Create notification
//     await Notification.create({
//       user: user._id,
//       title: "Property Created",
//       message: `Your property "${title}" was created successfully.`,
//       meta: { propertyId: prop._id },
//     });

//     // Broadcast to global socket
//     if (global.io)
//       global.io.emit("notification", {
//         type: "property_created",
//         title: "New Property Listed",
//         message: `New property "${title}" just got listed.`,
//         propertyId: prop._id,
//       });

//     res.status(201).json({ success: true, property: prop });
//   } catch (err) {
//     console.error("createProperty error:", err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

const createProperty = async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      escrowFee,
      address,
      propertyType,
      listingType,
      landSize, // for land only
      landUnit, // for land only
      landCondition, // for land only
      landDocTitle, // for land only
      landType, // for land only
      bedroom, // for apartment/house only
      bathroom, // for apartment/house only
      kitchen, // for apartment/house only
      inspectionFee,
      serviceCharge,
      nearbyPlaces, // array of strings
      ownerId, // OPTIONAL: target agent ID when created by an Admin
    } = req.body;

    const loggedInUser = req.user; // Logged in user (Agent or Admin)
    let targetOwnerUser = loggedInUser;

    // If an Admin is creating the property for an agent
    if (loggedInUser.role === "admin" && ownerId) {
      const targetAgent = await User.findById(ownerId);
      if (!targetAgent) {
        return res.status(404).json({
          success: false,
          message: "Target agent user not found.",
        });
      }
      targetOwnerUser = targetAgent;
    }

    // Build the subdocument owner object
    const owner = {
      _id: targetOwnerUser._id,
      name: targetOwnerUser.name,
      profilePicture: targetOwnerUser.profilePicture || null,
      isVerified: targetOwnerUser.isVerified || false,
      rating: targetOwnerUser.rating || 0,
      totalListings: targetOwnerUser.totalListings || 0,
    };

    // Upload images (multiple)
    const images = req.files?.images
      ? await uploadImages(req.files.images)
      : [];

    // Upload land document (multiple)
    const legalDocuments = req.files?.legalDocuments
      ? await uploadImages(req.files.legalDocuments)
      : [];

    // Upload video (single/multiple)
    const videos = req.files?.videos
      ? await uploadVideos(req.files.videos)
      : [];

    // Create property
    const prop = await Property.create({
      title,
      description,
      price,
      escrowFee,
      address,
      propertyType,
      listingType,
      landSize: propertyType === "land" ? landSize : null,
      landUnit: propertyType === "land" ? landUnit : null,
      landCondition: propertyType === "land" ? landCondition : null,
      landDocTitle: propertyType === "land" ? landDocTitle : null,
      landType: propertyType === "land" ? landType : null,
      legalDocuments: legalDocuments,
      bedroom: propertyType !== "land" ? bedroom : null,
      bathroom: propertyType !== "land" ? bathroom : null,
      kitchen: propertyType !== "land" ? kitchen : null,
      inspectionFee,
      serviceCharge,
      nearbyPlaces: nearbyPlaces || [],
      images,
      videos,
      owner,
    });

    // Send notification to the actual property owner/agent
    await Notification.create({
      user: targetOwnerUser._id,
      title: "Property Created",
      message: `Your property "${title}" was created successfully.`,
      meta: { propertyId: prop._id },
    });

    // Broadcast to global socket
    if (global.io) {
      global.io.emit("notification", {
        type: "property_created",
        title: "New Property Listed",
        message: `New property "${title}" just got listed.`,
        propertyId: prop._id,
      });
    }

    return res.status(201).json({ success: true, property: prop });
  } catch (err) {
    console.error("createProperty error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Get all properties
 */
const getAllProperties = async (req, res) => {
  try {
    const props = await Property.find({ status: "approved" }).sort({
      createdAt: -1,
    });
    res.json({ success: true, properties: props });
  } catch (err) {
    console.error("listProperties error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Get all properties for a specific agent
 */
const getAgentProperties = async (req, res) => {
  try {
    const requestedAgentId = req.params.id; // or req.query.agentId

    const props = await Property.find({
      "owner._id": requestedAgentId,
    });

    res.json({
      success: true,
      count: props.length,
      properties: props,
    });
  } catch (err) {
    console.error("getAgentProperties error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * @desc Get single property
 */
// const getProperty = async (req, res) => {
//   try {
//     const prop = await Property.findById(req.params.id).populate(
//       "owner",
//       "name email phoneNumber profilePicture",
//     );
//     if (!prop)
//       return res
//         .status(404)
//         .json({ success: false, message: "Property not found" });

//     // Notify owner that their property was viewed (optional)
//     await Notification.create({
//       user: prop.owner._id,
//       title: "Property Viewed",
//       message: `Your property "${prop.title}" was viewed.`,
//       meta: { propertyId: prop._id },
//     });

//     if (global.io)
//       global.io.emit("notification", {
//         type: "property_viewed",
//         title: "Property Viewed",
//         message: `Someone viewed "${prop.title}".`,
//         propertyId: prop._id,
//       });

//     res.json({ success: true, property: prop });
//   } catch (err) {
//     console.error("getProperty error:", err);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

const getProperty = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id).populate(
      "owner",
      "name email phoneNumber profilePicture",
    );
    if (!prop)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    // Check viewer identity (safely handling optional auth if guests can view)
    const viewerId = req.user?._id?.toString();
    const viewerRole = req.user?.role;

    const isOwner = viewerId && viewerId === prop.owner._id.toString();
    const isAdmin = viewerRole === "admin";

    // Only notify owner if the viewer is NEITHER the owner nor an admin
    if (!isOwner && !isAdmin) {
      await Notification.create({
        user: prop.owner._id,
        title: "Property Viewed",
        message: `Your property "${prop.title}" was viewed.`,
        meta: { propertyId: prop._id },
      });

      if (global.io) {
        global.io.emit("notification", {
          type: "property_viewed",
          title: "Property Viewed",
          message: `Someone viewed "${prop.title}".`,
          propertyId: prop._id,
        });
      }
    }

    res.json({ success: true, property: prop });
  } catch (err) {
    console.error("getProperty error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Update property
 */

const updateProperty = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id);
    if (!prop) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    // Check ownership or admin role
    if (
      prop.owner._id.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    const {
      title,
      description,
      price,
      escrowFee,
      address,
      propertyType,
      listingType,
      landSize,
      landUnit,
      landCondition,
      landDocTitle,
      landType,
      bedroom,
      bathroom,
      kitchen,
      inspectionFee,
      serviceCharge,
      nearbyPlaces, // array of strings (or stringified array from FormData)
    } = req.body;

    // Update basic text fields if provided
    if (title !== undefined) prop.title = title;
    if (description !== undefined) prop.description = description;
    if (price !== undefined) prop.price = price;
    if (escrowFee !== undefined) prop.escrowFee = escrowFee;
    if (address !== undefined) prop.address = address;
    if (propertyType !== undefined) prop.propertyType = propertyType;
    if (listingType !== undefined) prop.listingType = listingType;
    if (inspectionFee !== undefined) prop.inspectionFee = inspectionFee;
    if (serviceCharge !== undefined) prop.serviceCharge = serviceCharge;

    // Handle nearbyPlaces array safely (supports FormData parsing if sent as a string)
    if (nearbyPlaces !== undefined) {
      try {
        prop.nearbyPlaces =
          typeof nearbyPlaces === "string"
            ? JSON.parse(nearbyPlaces)
            : nearbyPlaces;
      } catch (e) {
        prop.nearbyPlaces =
          typeof nearbyPlaces === "string"
            ? nearbyPlaces.split(",").map((s) => s.trim())
            : nearbyPlaces;
      }
    }

    // Conditional propertyType-specific fields update
    const activePropertyType = propertyType || prop.propertyType;

    if (activePropertyType === "land") {
      if (landSize !== undefined) prop.landSize = landSize;
      if (landUnit !== undefined) prop.landUnit = landUnit;
      if (landCondition !== undefined) prop.landCondition = landCondition;
      if (landDocTitle !== undefined) prop.landDocTitle = landDocTitle;
      if (landType !== undefined) prop.landType = landType;

      // Clear apartment/house specific fields
      prop.bedroom = null;
      prop.bathroom = null;
      prop.kitchen = null;
    } else {
      if (bedroom !== undefined) prop.bedroom = bedroom;
      if (bathroom !== undefined) prop.bathroom = bathroom;
      if (kitchen !== undefined) prop.kitchen = kitchen;

      // Clear land specific fields
      prop.landSize = null;
      prop.landUnit = null;
      prop.landCondition = null;
      prop.landDocTitle = null;
      prop.landType = null;
    }

    // Handle new media/file uploads (appends or replaces based on your requirement)
    if (req.files?.images) {
      const newImages = await uploadImages(req.files.images);
      prop.images.push(...newImages); // Appends new images to existing ones
    }

    if (req.files?.legalDocuments) {
      const newLegalDocs = await uploadImages(req.files.legalDocuments);
      prop.legalDocuments.push(...newLegalDocs);
    }

    if (req.files?.videos) {
      const newVideos = await uploadVideos(req.files.videos);
      if (newVideos && newVideos.length > 0) {
        prop.videos.push(...newVideos);
      }
    }

    await prop.save();

    // Create notification
    await Notification.create({
      user: prop.owner._id,
      title: "Property Updated",
      message: `Your property "${prop.title}" was updated successfully.`,
      meta: { propertyId: prop._id },
    });

    // Broadcast to global socket
    if (global.io) {
      global.io.emit("notification", {
        type: "property_updated",
        title: "Property Updated",
        message: `Property "${prop.title}" was updated.`,
        propertyId: prop._id,
      });
    }

    res.status(200).json({ success: true, property: prop });
  } catch (err) {
    console.error("updateProperty error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// const updateProperty = async (req, res) => {
//   try {
//     const prop = await Property.findById(req.params.id);
//     if (!prop)
//       return res
//         .status(404)
//         .json({ success: false, message: "Property not found" });

//     // Check ownership or admin role
//     if (
//       prop.owner._id.toString() !== req.user._id.toString() &&
//       req.user.role !== "admin"
//     ) {
//       return res
//         .status(403)
//         .json({ success: false, message: "Not authorized" });
//     }

//     // Destructure all possible fields (Added listingType here)
//     const {
//       title,
//       description,
//       price,
//       address,
//       propertyType,
//       landType,
//       listingType, // <-- Added this
//       bedroom,
//       bathroom,
//       kitchen,
//       inspectionFee,
//       serviceCharge,
//       nearbyPlaces, // array
//     } = req.body;

//     // Update fields if provided
//     if (title) prop.title = title;
//     if (description) prop.description = description;
//     if (price) prop.price = price;
//     if (address) prop.address = address;
//     if (propertyType) prop.propertyType = propertyType;
//     if (listingType) prop.listingType = listingType; // <-- Added this check

//     // Conditional fields
//     if (prop.propertyType === "land") {
//       if (landType) prop.landType = landType;
//       prop.bedroom = undefined;
//       prop.bathroom = undefined;
//       prop.kitchen = undefined;
//     } else {
//       if (bedroom !== undefined) prop.bedroom = bedroom;
//       if (bathroom !== undefined) prop.bathroom = bathroom;
//       if (kitchen !== undefined) prop.kitchen = kitchen;
//       prop.landType = undefined;
//     }

//     if (inspectionFee !== undefined) prop.inspectionFee = inspectionFee;
//     if (serviceCharge !== undefined) prop.serviceCharge = serviceCharge;
//     if (nearbyPlaces) prop.nearbyPlaces = nearbyPlaces;

//     // Handle new uploads
//     if (req.files && req.files.images) {
//       const images = req.files.images.map(
//         (f) => f.path || f.url || f.secure_url || f.location || "",
//       );
//       prop.images.push(...images);
//     }

//     if (req.files && req.files.video && req.files.video[0]) {
//       const v = req.files.video[0];
//       prop.video = v.path || v.url || v.secure_url || v.location || prop.video;
//     }

//     await prop.save();

//     // Notify owner
//     await Notification.create({
//       user: prop.owner._id,
//       title: "Property Updated",
//       message: `Your property "${prop.title}" was updated.`,
//       meta: { propertyId: prop._id },
//     });

//     // Broadcast via socket
//     if (global.io)
//       global.io.emit("notification", {
//         type: "property_updated",
//         title: "Property Updated",
//         message: `Property "${prop.title}" was updated.`,
//         propertyId: prop._id,
//       });

//     res.json({ success: true, property: prop });
//   } catch (err) {
//     console.error("updateProperty error:", err);
//     res
//       .status(500)
//       .json({ success: false, message: "Server error", error: err.message });
//   }
// };

/**
 * @desc Delete property
 */
const deleteProperty = async (req, res) => {
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

/**
 * @desc Change property status (Admin only)
 * @route PATCH /api/properties/:id/status
 */
// const changePropertyStatus = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;

//     // Define valid status options
//     const validStatuses = ["pending", "approved", "rejected"];

//     if (!status || !validStatuses.includes(status)) {
//       return res.status(400).json({
//         success: false,
//         message: `Invalid status. Status must be one of: ${validStatuses.join(", ")}`,
//       });
//     }

//     // Verify that the user is an admin
//     if (req.user.role !== "admin") {
//       return res.status(403).json({
//         success: false,
//         message: "Access denied. Only admins can update property status.",
//       });
//     }

//     const property = await Property.findById(id);
//     if (!property) {
//       return res.status(404).json({
//         success: false,
//         message: "Property not found",
//       });
//     }

//     property.status = status;
//     await property.save();

//     return res.status(200).json({
//       success: true,
//       message: `Property status successfully updated to '${status}'`,
//       data: property,
//     });
//   } catch (err) {
//     console.error("changePropertyStatus error:", err);

//     if (err.kind === "ObjectId") {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid property ID format",
//       });
//     }

//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: err.message,
//     });
//   }
// };

const changePropertyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body; // Added optional 'reason' extraction

    // Define valid status options
    const validStatuses = ["pending", "approved", "rejected"];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Verify that the user is an admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can update property status.",
      });
    }

    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    property.status = status;
    await property.save();

    // --- BUG 7: Notify the agent/owner on approval or rejection ---
    let notificationMessage = `Your property "${property.title}" has been ${status}.`;
    if (status === "rejected" && reason) {
      notificationMessage += ` Reason: ${reason}`;
    }

    await Notification.create({
      user: property.owner,
      title: `Property ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      message: notificationMessage,
      meta: { propertyId: property._id },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: `property_${status}`,
        title: `Property ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        message: notificationMessage,
        propertyId: property._id,
      });
    }
    // -------------------------------------------------------------

    return res.status(200).json({
      success: true,
      message: `Property status successfully updated to '${status}'`,
      data: property,
    });
  } catch (err) {
    console.error("changePropertyStatus error:", err);

    if (err.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid property ID format",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * @desc Flag or unflag a property listing (Admin only)
 * @route PATCH /api/properties/:id/flag
 */
const flagProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const { flagged, reason } = req.body;

    // Verify that the user is an admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can flag property listings.",
      });
    }

    if (typeof flagged !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "The 'flagged' field must be a boolean (true or false).",
      });
    }

    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    // Update flag fields
    property.isFlagged = flagged;
    property.flagReason = flagged ? reason || "No reason provided" : null;
    property.flaggedAt = flagged ? new Date() : null;

    await property.save();

    return res.status(200).json({
      success: true,
      message: flagged
        ? "Property successfully flagged"
        : "Property unflagged successfully",
      property,
    });
  } catch (err) {
    console.error("flagProperty error:", err);

    if (err.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid property ID format",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * @desc Add an admin note to a property listing & notify the agent
 * @route POST /api/properties/:propertyId/notes
 */
const addAdminNote = async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { note } = req.body;

    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        message: "Note content cannot be empty.",
      });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can add notes.",
      });
    }

    const property = await Property.findById(propertyId).populate("owner");
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    const newNote = {
      note,
      author: {
        _id: req.user._id,
        name: req.user.name,
      },
      createdAt: new Date(),
    };

    property.adminNotes.push(newNote);
    await property.save();

    const savedNote = property.adminNotes[property.adminNotes.length - 1];

    // Notify agent/owner
    const ownerId = property.owner?._id || property.owner;
    if (ownerId) {
      const notificationMessage = `An admin left a note on your property "${property.title}": "${note}"`;

      await Notification.create({
        user: ownerId,
        title: "New Admin Note",
        message: notificationMessage,
        meta: { propertyId: property._id },
      });

      if (global.io) {
        global.io.emit("notification", {
          type: "admin_note_added",
          title: "New Admin Note",
          message: notificationMessage,
          propertyId: property._id,
        });
      }
    }

    return res.status(200).json({
      success: true,
      note: savedNote,
    });
  } catch (err) {
    console.error("addAdminNote error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Update an existing admin note
 * @route PATCH /api/properties/:propertyId/notes/:noteId
 */
const updateAdminNote = async (req, res) => {
  try {
    const { propertyId, noteId } = req.params;
    const { note } = req.body;

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can update notes.",
      });
    }

    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        message: "Note content cannot be empty.",
      });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    const targetNote = property.adminNotes.id(noteId);
    if (!targetNote) {
      return res.status(404).json({
        success: false,
        message: "Admin note not found",
      });
    }

    targetNote.note = note;
    await property.save();

    return res.status(200).json({
      success: true,
      note: targetNote,
    });
  } catch (err) {
    console.error("updateAdminNote error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Delete an admin note
 * @route DELETE /api/properties/:propertyId/notes/:noteId
 */
const deleteAdminNote = async (req, res) => {
  try {
    const { propertyId, noteId } = req.params;

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can delete notes.",
      });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    const targetNote = property.adminNotes.id(noteId);
    if (!targetNote) {
      return res.status(404).json({
        success: false,
        message: "Admin note not found",
      });
    }

    property.adminNotes.pull(noteId);
    await property.save();

    return res.status(200).json({
      success: true,
      message: "Admin note successfully deleted",
    });
  } catch (err) {
    console.error("deleteAdminNote error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createProperty,
  getAllProperties,
  getAgentProperties,
  getProperty,
  updateProperty,
  deleteProperty,
  changePropertyStatus,
  flagProperty,
  addAdminNote,
  updateAdminNote,
  deleteAdminNote,
};
