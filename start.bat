@echo off
title Kick TTS Reader - Setup

if not exist "node_modules" npm install & npm run start
npm run start