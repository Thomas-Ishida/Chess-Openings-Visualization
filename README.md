# Chess Openings Visualization

An interactive web application for exploring chess openings through **board control heatmaps**, **move suggestions**, and **decision-tree visualizations** built from real PGN data.

## Live Demo

[View the deployed site on GitHub Pages](https://thomas-ishida.github.io/Chess-Openings-Visualization/)

---

## Overview

This project helps users understand chess openings in a more visual and intuitive way.

Instead of only reading move lists, users can:

- explore how different openings influence control of the board
- see which squares are under pressure from each side
- compare likely continuations from real PGN-derived opening data
- inspect out-of-book engine suggestions
- visualize decision trees of common continuation lines

The goal is to make opening study more interactive, spatial, and easier to understand.

---

## Features

### Interactive chessboard
- Click-to-move legal chess interaction
- Live board state updates
- Reset and undo controls

### Board control heatmap
- White control view
- Black control view
- Whole-board difference view
- Pseudo-legal pressure visualization for each square

### Opening explorer
- Curated opening starting positions
- Opening descriptions, ideas, and common mistakes
- Real-time current-line tracking

### Suggestion system
- **Statistics mode** based on PGN-derived continuation data
- **Engine mode** for out-of-book analysis
- **Auto mode** to switch between them depending on data availability

### Decision tree visualization
- Branching continuation tree built from PGN data
- Move frequencies
- Game counts
- Win / draw / loss breakdowns

### Piece emphasis
- Highlight pieces based on:
  - continuation likelihood
  - current control contribution
  - both combined

---

## Tech Stack

- **React**
- **Vite**
- **TypeScript**
- **D3.js**
- **chess.js**

---

## Data Sources

This project uses multiple sources of data depending on the feature:

### 1. Opening metadata
Local curated opening data stored in JSON:
- opening names
- ECO codes
- descriptions
- strategic ideas
- common mistakes

### 2. PGN decision-tree dataset
The statistical continuation system and tree visualization are built from PGN data:
- PGN games are parsed into opening-specific tries
- move frequencies are computed from real game branches
- the tree and statistics panel use the same source of truth

### 3. Cloud engine evaluation
When a position is out of book, engine suggestions are loaded from a cloud evaluation API:
- best engine lines
- evaluation scores
- first-move previews

---

## How It Works

### Statistical suggestions
For positions covered by the PGN dataset, the app builds continuation branches from the opening trie and shows:
- likely next moves
- percentage of games
- game counts
- win/draw/loss summaries

### Engine suggestions
When no statistical continuation is available for the current position, the app switches to engine fallback:
- cloud engine suggestions
- evaluation scores
- preview board for the first move

### Heatmap
The heatmap is calculated from the current board state using pseudo-legal square influence:
- each piece contributes pressure to squares it attacks
- color intensity reflects relative control in the current position

---

## Local Development

### Install dependencies
```bash
npm install
