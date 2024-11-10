// config/mongo.js
const mongoose = require('mongoose');

// Set Mongoose options
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  connectTimeoutMS: 20000, // 20-second timeout
};

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, mongooseOptions)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Error connecting to MongoDB:', err));

// Export mongoose instance for use in other files
module.exports = mongoose;
