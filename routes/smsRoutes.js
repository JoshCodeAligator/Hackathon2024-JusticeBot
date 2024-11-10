const express = require('express');
const { handleIncomingSMS } = require('../controllers/messageController');

const router = express.Router();

router.post('/sms', handleIncomingSMS);

module.exports = router;
