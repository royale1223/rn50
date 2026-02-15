#!/bin/bash

PID=$(pgrep -f "node server.js")
if [ -n "$PID" ]; then
  echo "Stopping existing process (PID: $PID)..."
  kill $PID
  sleep 1
else
  echo "No existing process found."
fi

echo "Starting server..."
nohup node server.js > logs.out 2>&1 &
echo "Server started (PID: $!)"