---
layout: page
---

<style>
.preview-section {
  max-width: 900px;
  margin: 3rem auto;
  padding: 0 1.5rem;
}
.preview-section h2 {
  font-family: 'Bricolage Grotesque', sans-serif;
  font-size: 1.5rem;
  font-weight: 800;
  margin-bottom: 0.5rem;
}
.preview-section p {
  color: #94A3B8;
  margin-bottom: 1.5rem;
  font-size: 0.9rem;
}
</style>

<div class="preview-section">

## Option 1 — Terminal animé

Mini-terminal qui joue des événements en temps réel : scheduling, retry, rate limiting, flows, cron. Chaque ligne montre une feature en action avec des badges colorés.

<AnimTerminal />

</div>

<div class="preview-section">

## Option 2 — Pipeline interactif

4 colonnes (Delayed → Waiting → Active → Completed) avec des jobs qui se déplacent entre les étapes. Labels en bas indiquant quelle feature est illustrée.

<AnimPipeline />

</div>

<div class="preview-section">

## Option 3 — Dashboard live

Vue monitoring avec compteurs animés, panneau workers (idle/busy), event feed, et barre de progression de la queue.

<AnimDashboard />

</div>
