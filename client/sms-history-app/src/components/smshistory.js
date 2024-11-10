// src/components/SMSHistory.js
import React, { useState } from 'react';
import axios from 'axios';

function SMSHistory() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchMessages = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`/api/messages?phone=${phoneNumber}`);
      setMessages(response.data);
    } catch (err) {
      setError('Error fetching messages. Please try again.');
    }
    setLoading(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (phoneNumber) {
      fetchMessages();
    } else {
      setError('Please enter a valid phone number.');
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>SMS History</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Phone Number:
          <input
            type="text"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+1234567890"
            required
          />
        </label>
        <button type="submit">Fetch History</button>
      </form>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      <h3>Message History</h3>
      <ul>
        {messages.map((msg) => (
          <li key={msg.id}>
            <strong>{msg.timestamp.toDate().toString()}</strong>: {msg.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SMSHistory;
