const express = require('express');
const router = express.Router();
const { handleIncomingSMS } = require('../controllers/messageController');

router.post('/', handleIncomingSMS);

module.exports = router;
