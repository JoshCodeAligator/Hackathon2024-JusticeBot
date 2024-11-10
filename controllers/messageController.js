// controllers/messageController.js
const Message = require('../models/Message'); // Import the Message model
const detectIntent = require('../config/dialogflow'); // Import Dialogflow config
const twilioClient = require('../config/twilio'); // Import Twilio client

async function handleIncomingSMS(req, res) {
  const { Body, From } = req.body;
  const projectId = process.env.DIALOGFLOW_PROJECT_ID;

  if (!Body || !From) {
    console.error('Invalid message: missing Body or From');
    return res.status(400).json({ error: 'Invalid message: Body and From are required' });
  }

  // Log the message to MongoDB
  try {
    const message = new Message({
      phoneNumber: From,
      text: Body,
    });
    await message.save();
    console.log('Message logged to MongoDB');
  } catch (error) {
    console.error('Error logging message to MongoDB:', error);
    return res.status(500).send('Error logging message');
  }

  // Pass message text to Dialogflow
  try {
    const dialogflowResponse = await detectIntent(projectId, From, Body); // Body is user message
    const responseMessage = dialogflowResponse.fulfillmentText || "I'm not sure how to respond to that.";

    // Send the response back to the user via Twilio
    await twilioClient.messages.create({
      body: responseMessage,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: From,
    });

    res.status(200).send('Message sent!');
  } catch (error) {
    console.error('Error processing or sending message:', error);
    res.status(500).send('Error processing or sending message');
  }
}

module.exports = {
  handleIncomingSMS,
};

