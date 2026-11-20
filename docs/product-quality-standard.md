# Floor Fifty Product Quality Standard

## Purpose

Floor Fifty is a modern competitive arcade game whose craft target is the
clarity, responsiveness, personality, and economy associated with a
first-party Nintendo handheld game. Its visual reference point is the Game Boy
Advance era, but the shipped experience may use modern networking,
accessibility, display, audio, and input features.

This document defines the quality bar shared by every remaining initiative. It
does not require imitation of Nintendo characters, worlds, UI, music, or other
protected expression. The reference is a standard of finish: every visible and
audible choice should feel deliberate, immediately understandable, and refined
through observation of real players.

The competitive aspiration is a game-jam winner for both presentation and
gameplay. That outcome cannot be guaranteed by a checklist. The requirements
below identify the evidence the project must produce before it can credibly aim
for it.

## Product Pillars

### Immediate clarity

Within a brief glance, a player can find their racer, the next usable landing
surface, their progress, and the current leader. Background roofs, effects,
other racers, and display treatments never compete with those facts.

### Expressive economy

Small sprites and short animations communicate anticipation, ascent, fall,
impact, recovery, and victory through strong poses and timing. Detail is spent
where it changes the player's reading or emotional response. Repetition,
effects, and interface decoration remain restrained.

### Precise, learnable play

Movement answers immediately and produces repeatable outcomes. A failure can
be explained from what appeared on screen. Players can form an intention,
execute it, recognize the result, and improve on the next attempt.

### Music that amplifies movement

Music, animation, floor pulses, landing accents, and camera response make the
climb feel rhythmically coherent without judging the player against the beat.
The same inputs produce the same movement, collision, timing, score, and result
whether music is playing, muted, delayed, or unavailable. Beat-synchronized
presentation may emphasize a landing, but it never changes what that landing
does.

### A complete emotional arc

Joining, counting down, landing, taking the lead, recovering, finishing, and
choosing to race again each have a distinct response. Audio, animation, camera,
and interface work together without hiding authoritative outcomes or delaying
control.

## Approved Visual Direction

The approved direction is **Aquarian: cool pearl and blue interface materials,
confident editorial typography, the existing pixel racers, and a richer
refracted city at dawn**. The
beauty-pass spec
and [accepted concept](art/explorations/2026-09-20-refinement/aquarian.png)
control this refinement. Implementation and final visual acceptance remain
outstanding. The earlier art brief remains the world/sprite preservation
reference where the new spec does not supersede it.

World art retains its palette-locked composite; smooth UI is a separate layer
with authored Aquarian color tokens. The beauty pass preserves the checkout's
current LCD default rather than introducing a settings change. The LCD effect
must not be required for contrast, identity, or style.
The art direction preserves the city at dawn, four equivalent recolored seats,
automatic bounce, and the existing logical viewport while reducing background
competition and strengthening character appeal, landing edges, and UI order.

## Core Gameplay Standard

Wall contact may remain a defining technique only when all of the following are
true in unprompted playtests:

- players recognize that it is intentional rather than a collision defect;
- players can reproduce it after seeing or discovering it;
- the resulting trajectory is predictable enough to support route planning;
- misses communicate whether timing, horizontal commitment, fast fall, or
  route choice caused the error;
- beat-synchronized presentation never obscures the timing or result of a top
  landing or any required wall interaction.

Course generation must do more than produce finishable seeds. A representative
course needs an authored difficulty and teaching curve: an opening that teaches,
a middle that asks for combinations, recovery opportunities that preserve
hope, and a finish that creates tension without arbitrary failure. Procedural
variation must operate inside an accepted course grammar rather than treating
every mechanically completable arrangement as equally desirable.

## Experience Standard

A first-time player reaches meaningful play without needing spoken guidance.
The game teaches automatic bounce, horizontal steering, fast fall, collection,
recovery/reset, and any retained wall technique through a short playable
sequence or contextual prompts that disappear once understood.

Restarting or racing again is fast. Lobby and selection flows preserve focus,
work with keyboard and touch, and do not obscure the primary action. Controller
support and remapping are release requirements for desktop play; touch comfort
is judged on physical portrait and landscape devices.

Audio must be evaluated as part of control feel. Landing transients, beat
accents, reset cues, countdown, lead changes, lap completion, finish, and music
mix all need authored assets and a coherent mix. Muted play still communicates
every outcome, while reduced-motion play preserves timing and state changes.

## Quality Gates

Automated checks protect determinism, authority, accessibility, performance,
asset validity, and regressions. They cannot approve feel or art.

A milestone passes only when fresh players have been observed on the current
build. The review record must include build revision, devices, player
experience, task prompts, observations, and resulting decisions. A pass
requires:

1. At least four of five first-time players can enter a race and explain the
   objective without coaching.
2. At least four of five can identify why they missed a platform or lost
   momentum after no more than three attempts.
3. Every player demonstrates deliberate use of horizontal steering and fast
   fall; if wall-riding remains, every player can deliberately reproduce it.
4. A majority improves a recorded course segment over three attempts and asks
   for or accepts an immediate retry without prompting.
5. In four-player play, every participant can locate their racer and read the
   next landing edge during overlap, effects, and camera motion.
6. Beat-synchronized feedback reads as presentation rather than a hidden rule
   across supported desktop and mobile paths; audio or device latency never
   changes gameplay and does not imply that an ordinary landing failed.
7. No critical readability, input, audio, comfort, or frame-time issue remains
   open. Aesthetic preference disagreements may remain only when the chosen
   direction and reason are recorded.

These are minimum evidence thresholds, not optimization targets. Passing them
does not end iteration when observation reveals a weaker experience.

## Review Order

Review the representative race in this order:

1. movement and course comprehension with temporary presentation sufficient to
   expose contact and timing;
2. clean production art and UI with the LCD effect disabled;
3. essential music, sound, animation, and feedback;
4. four-player overlap and network conditions;
5. desktop keyboard/controller and physical mobile touch;
6. optional LCD and quality settings;
7. broader modes, selection, progression-adjacent surfaces, and services.

Breadth does not advance while the representative race fails its quality gate.
