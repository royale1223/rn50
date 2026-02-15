#!/bin/bash

kill $(pgrep -f "node server.js")
nohup node server.js > logs.out 2>&1 &