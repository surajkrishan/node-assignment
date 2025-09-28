// middleware/auth.js
const jwt = require("jsonwebtoken");
const winston = require("winston");
const logger = winston.createLogger({
  transports: [new winston.transports.Console()],
});

/**
 * Authentication middleware
 * Verifies JWT token and attaches user ID to request
 */
module.exports = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: "No authorization header",
        message: "Please provide a valid token",
      });
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      return res.status(401).json({
        error: "No token provided",
        message: "Please provide a valid token",
      });
    }

    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    );

    // Attach user ID to request
    req.userId = decoded.userId;
    req.userEmail = decoded.email;

    logger.debug(`Authenticated request from user: ${decoded.email}`);

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        error: "Invalid token",
        message: "The provided token is invalid",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Token expired",
        message: "Please login again",
      });
    }

    logger.error("Authentication middleware error:", error);
    res.status(500).json({
      error: "Authentication failed",
      message: error.message,
    });
  }
};
