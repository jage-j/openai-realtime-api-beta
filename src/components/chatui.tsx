import React, { useState, useEffect, useRef } from 'react';
import { RealtimeClient } from '@openai/realtime-api-beta';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface WindowWithAudioContext extends Window {
  webkitAudioContext?: typeof AudioContext;
  AudioContext?: typeof AudioContext;
}

const ChatUI = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [client, setClient] = useState<RealtimeClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<MediaRecorder | null>(null);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>('');
  const [isAssistantTyping, setIsAssistantTyping] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const initClient = async () => {
      try {
        const newClient = new RealtimeClient({
          apiKey: process.env.REACT_APP_OPENAI_API_KEY,
          dangerouslyAllowAPIKeyInBrowser: true,
        });

        await newClient.connect();
        setClient(newClient);
        setIsConnected(true);

        newClient.on('conversation.updated', ({ item, delta }) => {
          if (item.role === 'assistant') {
            if (delta?.text) {
              setCurrentAssistantMessage(prevMessage => prevMessage + delta.text);
              setIsAssistantTyping(true);
            }
            if (delta?.audio) {
              playAudio(delta.audio);
            }
            if (item.status === 'completed') {
              setMessages(prevMessages => [
                ...prevMessages,
                { role: 'assistant', content: item.formatted.text || item.formatted.transcript }
              ]);
              setCurrentAssistantMessage('');
              setIsAssistantTyping(false);
            }
          } else if (item.role === 'user' && item.status === 'completed') {
            setMessages(prevMessages => [
              ...prevMessages,
              { role: 'user', content: item.formatted.text || item.formatted.transcript }
            ]);
          }
        });
      } catch (err) {
        console.error('Failed to initialize client:', err);
        setError('Failed to connect to the AI service. Please try again later.');
      }
    };

    initClient();

    return () => {
      if (client) {
        client.disconnect();
      }
    };
  }, []);

  const sendMessage = async () => {
    if (inputText.trim() === '' || !client || !isConnected) return;

    try {
      client.sendUserMessageContent([{ type: 'input_text', text: inputText }]);
      setInputText('');
    } catch (err) {
      console.error('Failed to send message:', err);
      setError('Failed to send message. Please try again.');
    }
  };

  const startRecording = async () => {
    setIsRecording(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioRef.current = new MediaRecorder(stream);
      const audioChunks: Blob[] = [];

      audioRef.current.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      audioRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const dataView = new DataView(arrayBuffer);
        const int16Array = new Int16Array(dataView.byteLength / 2);
        for (let i = 0; i < int16Array.length; i++) {
          int16Array[i] = dataView.getInt16(i * 2, true); // true for little-endian
        }
        const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(int16Array.buffer)));
        client?.sendUserMessageContent([{ type: 'input_audio', audio: base64Audio }]);
      };

      audioRef.current.start();
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('Failed to start recording. Please check your microphone permissions.');
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (audioRef.current) {
      audioRef.current.stop();
      setIsRecording(false);
    }
  };

  const playAudio = async (audioData: Int16Array) => {
    if (!audioContextRef.current) {
      const WindowWithAudio = window as WindowWithAudioContext;
      const AudioContextConstructor = WindowWithAudio.AudioContext || WindowWithAudio.webkitAudioContext;
      if (AudioContextConstructor) {
        audioContextRef.current = new AudioContextConstructor();
      } else {
        throw new Error('AudioContext is not supported in this browser');
      }
    }

    const audioContext = audioContextRef.current;
    const audioBuffer = audioContext.createBuffer(1, audioData.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < audioData.length; i++) {
      channelData[i] = audioData[i] / 32768;
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start();
  };

  return (
    <div className="chat-ui">
      {error && <div className="error-message">{error}</div>}
      <div className="message-list">
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            {message.content}
          </div>
        ))}
        {isAssistantTyping && (
          <div className="message assistant streaming">
            {currentAssistantMessage}
            <span className="typing-indicator">...</span>
          </div>
        )}
      </div>
      <div className="input-area">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          disabled={!isConnected || isAssistantTyping}
        />
        <button onClick={sendMessage} disabled={!isConnected || isAssistantTyping}>Send</button>
        <button onClick={isRecording ? stopRecording : startRecording} disabled={!isConnected || isAssistantTyping}>
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>
      </div>
    </div>
  );
};

export default ChatUI;
