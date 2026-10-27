import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/* ══ Checklist ════════════════════════════════════════════
   Three tasks, and the only thing this block does is cross
   one out.

   ONE SPRING PER ROW, AND EVERYTHING IS READ OFF IT. The box
   filling, the tick drawing, the rule crossing the words and
   the words giving up their ink are four readings of a single
   number, not four things animated toward the same moment.
   With four transitions there are four chances for one to
   arrive early and break the illusion that this is one event;
   with one number there are none — the same rule the player
   follows, and the reason nothing in this component's
   stylesheet carries a transition of its own.

   WHERE THE OVERSHOOT IS ALLOWED, AND WHERE IT IS NOT. A
   spring goes past its target and comes back, which is what
   makes a check feel like a press rather than a state change
   — but only some of these can survive that. The fill takes
   the raw value, so the box swells past full and settles. The
   TICK and the RULE take it clamped: a tick that overshoots
   draws itself past its own end and pulls back, which is a
   glitch rather than a bounce, and a rule that overshoots
   runs off the end of the word it is crossing out.

   One spring, two readings of it, and the difference is one
   `clamp`. */

/* ── inlined from lab/spring ──────────────────────── */
/* ── one spring, for everything that settles ───────────────
   The maths was already on this bench twice, copied by hand:
   Humidity's wheel and Brightness's column both accumulate
   velocity toward a target, damp it, and snap when both the
   delta and the velocity fall under 0.02. Two copies is a
   coincidence; five would be a policy, so it comes out here
   before the elastic blocks are written against it.

   The two shipped copies are deliberately NOT refactored onto
   this. They work, they are tuned, and rewriting the innards
   of two live components to prove a point about duplication
   is how a good afternoon becomes a bad one. This is the one
   new code uses.

   Frames, not milliseconds. `dt` is expressed in sixtieths of
   a second and the damping is RAISED to it rather than
   multiplied by it, so a dropped frame decays the same amount
   of energy as the two frames it replaced. Multiplying is the
   version that makes a spring behave differently on a busy
   page, which is the hardest kind of bug to see.

   The loop parks itself the moment the value has settled.
   CLAUDE.md is not complimentary about the one permanent
   requestAnimationFrame already on this bench and there is no
   case for five more. */

/* 0..100 into the two numbers a spring actually has.

   50 is what Humidity and Brightness were tuned at, which is
   the rule every elastic knob on this bench follows — see
   lab/motion. Turn the panel to the middle and nothing has
   changed.

   Both ends have to be usable, which is what fixes the range:
   at 0 it is slow and heavy and still arrives, at 100 it is
   quick with a visible overshoot, and nowhere in between does
   it ring for longer than it takes to read. */
/* The pair is chosen by DAMPING RATIO and then written back
   as stiffness and decay, because the ratio is the thing a
   person is actually setting and the two numbers on their own
   do not say what they add up to.

     zeta = -ln(d) / (2 * sqrt(k))

   The first version of this ran 0.06..0.26 stiffness against
   0.93..0.74 decay, which reads as a sensible spread and is
   not one: it puts zeta between 0.15 and 0.16 across the
   WHOLE range, so every setting overshot by about sixty per
   cent and the knob only changed how fast it did it. Pull's
   return went 130px past its own resting position and lifted
   the content off the top of the card.

     0   → zeta ~0.85, heavy, arrives without a ring
     50  → zeta ~0.41, near where Humidity and Brightness sit
     100 → zeta ~0.20, lively, two visible rebounds

   Both ends shippable, which is the constraint that fixed the
   numbers rather than taste. */
const springOf = (tune: number) => ({
  /* stiffness: how hard it is pulled toward the target */
  k: 0.08 + (tune / 100) * 0.16,
  /* decay, per frame: how much of the velocity survives */
  d: 0.62 + (tune / 100) * 0.2,
});

/* Units matter. The snap threshold is absolute, so a caller
   works in pixels or in 0..100 — a spring driven over 0..1
   would be "settled" before it had visibly moved. */
function useSpring(target: number, tune = 50, instant = false) {
  const [at, setAt] = useState(target);
  const cur = useRef(target);
  const vel = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    if (instant) {
      cur.current = target;
      vel.current = 0;
      setAt(target);
      return;
    }
    const { k, d } = springOf(tune);
    let prev = 0;
    const tick = (t: number) => {
      const dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1;
      prev = t;
      vel.current += (target - cur.current) * k * dt;
      vel.current *= Math.pow(d, dt);
      cur.current += vel.current * dt;
      if (Math.abs(target - cur.current) < 0.02 && Math.abs(vel.current) < 0.02) {
        cur.current = target;
        vel.current = 0;
        setAt(target);
        raf.current = 0;
        return;
      }
      setAt(cur.current);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    /* `tune` sits here beside `target` for the reason
       Brightness spells out: the loop closes over it, so
       without it a knob turned mid-flight would do nothing
       until something else restarted the effect. Restarting
       picks up from the refs, so it continues rather than
       snapping. */
  }, [target, tune, instant]);

  return at;
}

/* Read once, the way the wheel and the pill nav do. A
   preference, not a live input. */
const stillness = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const W = 300;
/* the inset, and it is the SAME on all four sides — which is
   not what `padding: 14px` gives you here. See the note where
   it is used. */
const PAD = 14;
/* 40, down from 52. The gap between two tasks is whatever the
   row has left over after the box, twice — so 52 put 30px
   between them and read as a list of three separate things.
   40 leaves 18, which is a list. */
const ROW = 40;
/* 18, against 14px text. 22 was the first number and it had
   no reasoning behind it beyond looking balanced on its own —
   which is the trap with a control next to type: a checkbox is
   sized against the LINE it sits beside, and at 22 it was
   half again the cap height of the words it belonged to and
   read as the subject of the row rather than as its switch. */
const BOX = 18;
const CORNER = 20;
const BOUNCE = 50;

/* ── the rule follows the tick, it does not race it ────────
   Both are read off the same spring, but the rule starts a
   tenth of the way in and finishes a little early — so the
   box answers first and the words are crossed out after,
   which is the order the two things actually happen in when a
   person ticks something off a list. Started together they
   read as one wipe across the whole row; started apart they
   read as cause and effect.

   It is a window on the same number rather than a second
   timer, so there is nothing to keep in step. */
const LAG = 0.12;
const RUN = 0.72;

/* ══ the finish ═══════════════════════════════════════════
   Tick the last open task and the list FALLS DOWN.

   What was here was a celebration: a box that bounced, three
   marks that redrew, the rows gathering in, a squish, and a
   four-point glint out of the middle of the card. All of it
   ran off one clock, which was the right way to build the
   wrong idea — five flourishes agreeing with each other is
   still five flourishes, and the glint in particular was a
   sparkle sitting on top of a list, which is what every
   "well done" animation on the internet already is.

   This is one idea instead. Finishing the list takes the
   floor out from under it: the three rows stop being held up,
   fall, and land in a heap on the bottom edge of the card.
   Nothing congratulates you. The list is simply over, and it
   behaves like something that is over.

   And the card is the size it always was. See the note on the
   collapse below: the distance comes out of the list closing
   up, not out of empty floor added under it. */

/* ── THE FALL IS A COLLAPSE, not a drop ───────────────────
   The card is exactly as tall as its three rows again, which
   is where it started and where it belongs — a checklist with
   a hundred pixels of empty floor under it is a checklist that
   looks unfinished. So there is nowhere to fall TO, and the
   distance has to come from somewhere else.

   It comes from the rows closing up. A row is 40px tall and
   the thing you can see in it — the box and the words — is
   barely twenty: the rest is the reason the whole row is a
   target rather than the checkbox alone. Standing in a list
   those gaps are what makes it a list. Lying in a heap they
   are nothing, and the slips settle against each other.

   So the heap is tighter than the list by twice that slack per
   row, and THAT is the fall. The bottom row barely moves, the
   top one travels the whole compaction, and each lands where
   the one below it stopped. */

/* ── what a row actually looks like ───────────────────────
   The taller of its checkbox and its line of type, and NOTHING
   added on top of that — both MEASURED, because the line box
   of 14px type is not 14px and a guess at it is a guess at how
   close two slips can lie. Derived from the Box knob, so the heap
   stays tight at every setting of it rather than at the
   default one.

   It carried four pixels of air at first, on the reasoning
   that a slip wants a margin. It does not: the slip is the
   card's own colour, so its edge is invisible and the margin
   is not protecting anything — the only thing that must not
   happen is a neighbour's slip covering this row's words, and
   the derived gap already guarantees with room to spare. What the
   four pixels DID do was eat the fall, because every pixel of
   slack a slip keeps is a pixel the heap cannot close up.
   Measured at the largest Box: 10px of collapse with the
   padding, 18 without it. */
const BODY = (side: number, line: number) => Math.max(side, line);

/* how long the FURTHEST fall takes; the others are shorter in
   proportion, because they are all under one gravity */
const DROP_MS = 0.46;
/* how far it comes back up off the floor, at most. A landing
   with no bounce at all reads as a card being placed — but a
   9px rebound on an 8px fall reads as a trampoline, so it is
   capped against the distance actually travelled. */
const REBOUND = 8;
/* Framer wants an array it can own, and `as const` alone hands
   it a readonly one — spread at the call site */
const FALL_EASE = ["easeIn", "easeOut", "easeIn"] as const;

/* how long the heap lies there before the list comes back */
const HOLD = 3000;

/* ── the heap ──────────────────────────────────────────────
   Three slips landing on each other do not land square, and
   the tilt is what stops this reading as the list closing up.
   Small — three degrees is a shrug, not a mess — and different
   per row so the eye cannot find a pattern in it. */
/* ── THE TILT IS THE OVERHANG ──────────────────────────────
   It was a hand-written fan: five numbers, the same lean every
   time, whatever was written on the slips. Which is fine until
   you notice what it is pretending to be. A slip lying on
   another slip is held up by exactly as much of it as there is
   underneath; the rest hangs, and what hangs, tips.

   So the lean comes out of the WORDS now. Each row is measured
   — the box, the gap and the line of type, to the end of the
   text — and a slip that is longer than the one it lands on
   overhangs to the right by the difference and leans that way.
   A shorter one is fully carried and adds nothing of its own.

   It ACCUMULATES from the floor up, because a slip resting on
   a tilted slip starts tilted: the bottom one lies flat on the
   card, and every one above inherits the lean of what it is
   lying on plus whatever its own overhang adds. That is what
   makes a heap of long-then-short read differently from
   short-then-long, which is the whole point of measuring.

   The response SATURATES rather than being a rate. Straight
   degrees-per-pixel put the default list at 0.9 degrees, which
   is a heap you have to be told is leaning, and then needed a
   clamp anyway the moment somebody typed a long task. This
   curve is at two degrees for the sixteen pixels those three
   tasks differ by, four and a half by sixty, and never reaches
   six — which is the angle where a slip stops looking like it
   is resting on something and starts looking dropped. */
const MAX_LEAN = 6;
const REACH = 40;
const leanOf = (over: number) => MAX_LEAN * (1 - Math.exp(-over / REACH));
/* the sideways untidiness, which the words have no opinion
   about — this is the one thing left that is just chosen */
const DRIFT = [-5, 4, -2, 5, -3];

/* ── the daylight between two slips ───────────────────────
   Tilting a slip moves its ends: two of them leaning by
   different amounts converge on one side, and if they converge
   by more than the gap the upper one's edge covers the lower
   one's words. So the spacing is computed from the leans
   rather than picked — and since the leans now come from the
   text, per render.

   MEASURED WHERE THE INK IS, not across the row. This used to
   ask what the slips do at x = 272, which is the end of the
   ROW — and the row is invisible. A slip is the card's own
   colour; the only place it can hide anything is where there
   is something under it to hide, and the words stop at 131 to
   147px. Asking the question at the end of the row inflated
   the gap to 5.7px for a two degree lean when the real answer
   at the end of the WORDS is 0.4, and pushed every slip five
   pixels apart for a collision that could not happen.

   Rotation is about the row's middle, so a point at x is
   displaced by (x - middle) * sin. The worst case between two
   slips is at the far end of the longer one's ink. */
const SPAN = W - PAD * 2;
const MID = SPAN / 2;
const sin = (deg: number) => Math.sin((deg * Math.PI) / 180);
const gapFor = (leans: number[], runs: number[]) =>
  1 +
  Math.max(
    0,
    ...leans.slice(1).map((below, i) => {
      const ink = Math.max(runs[i] ?? MID, runs[i + 1] ?? MID);
      return Math.max(0, (ink - MID) * (sin(leans[i]) - sin(below)));
    }),
  );

/* ── what is on the list ───────────────────────────────────
   Three real lines, short enough that the rule crosses each
   one in a single visible stroke and different enough in
   length that you can see it is measuring the WORDS rather
   than the row. Placeholder text would have made them the
   same length and lost that. */
const TASKS = ["Book the studio", "Send the estimate", "Pick a typeface"];

/* ── and it can be added to ────────────────────────────────
   Five, which is three that come with it and two of your own.
   A cap rather than an open list because the card is a fixed
   box on a wall of fixed boxes: something has to say when it
   is full, and a number you can see the end of is kinder than
   a scrollbar appearing inside a block.

   The spare row goes when the list is full — an "add" that
   cannot add is a control lying about itself. */
const MAX = 5;

export function Checklist({
  corner = CORNER,
  /* how far the box swells past full before it settles,
     0..100 — 0 is a spring that arrives dead, which is a
     perfectly good checkbox and is what most of them do */
  bounce = BOUNCE,
  /* the box, px */
  box = BOX,
}: {
  corner?: number;
  bounce?: number;
  box?: number;
} = {}) {
  /* ── one array, not two ─────────────────────────────────
     The list used to be a constant and the ticks a parallel
     array of booleans, which was fine while the list could not
     change. It can now, and two arrays that have to stay the
     same length are two arrays that will not. */
  const [items, setItems] = useState(() =>
    TASKS.map((text) => ({ text, done: false })));
  /* the row being typed into, or null. The draft is separate
     from the list so an abandoned one leaves nothing behind. */
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  /* ── how long each row actually is ───────────────────────
     Reported UP from the rows, because only they can see it:
     the width of a line of type is a question for the font,
     not for the character count, and "Send the estimate" is
     seventeen characters that set narrower than fifteen of
     somebody else's. offsetWidth rather than a rect, since the
     block is drawn under a scale on the wall and a rect would
     come back already multiplied. */
  const [runs, setRuns] = useState<number[]>([]);
  /* and how tall a line of it sets, which is the other half of
     how close two slips can lie */
  const [line, setLine] = useState(20);
  const measure = useCallback((i: number, px: number, tall: number) => {
    setRuns((v) => (v[i] === px ? v : Object.assign([...v], { [i]: px })));
    setLine((v) => (v === tall ? v : tall));
  }, []);

  const still = stillness();

  const r = clamp(corner, 0, 40);
  const side = clamp(Math.round(box), 14, 28);

  /* ── the whole finish, as one derived boolean ────────────
     Not a state. Every task ticked IS the finish, so there is
     nothing to keep in step: unticking one during the three
     seconds makes this false on the same render and the rows
     start climbing back without anything having to remember
     that they had fallen. That is the entire "you can undo
     it while it is on the floor" behaviour, and it is free. */
  const fell = items.length > 0 && items.every((t) => t.done);
  /* the spare row, and it holds its space even while the heap
     is down — fading it is a paint, removing it would change
     the card's height in the middle of a fall */
  const spare = items.length < MAX;

  /* ── and it puts itself away ─────────────────────────────
     Three seconds on the floor, then the list is new again.
     Cleared if `fell` goes false first, so unticking a task
     cancels the reset rather than having it fire later and
     wipe the box you just reopened. */
  useEffect(() => {
    if (!fell) return;
    /* ── ALL THE WAY BACK, tasks included ────────────────
       It used to only take the ticks off and leave anything
       you had added, on the reasoning that deleting your work
       is the block presuming. Which is true of an app and not
       of this: it is a demonstration on a wall, the three
       tasks are part of what it demonstrates, and a visitor
       who adds two and walks away leaves the next person a
       block in a state its author never chose.

       Going back to three also gives the card its closing
       animation for free — the same height transition that
       opened it runs in reverse. */
    const id = window.setTimeout(
      () => setItems(TASKS.map((text) => ({ text, done: false }))),
      HOLD,
    );
    return () => window.clearTimeout(id);
  }, [fell]);

  /* ── the vertical padding is DERIVED, not declared ───────
     A row is taller than the box in it, for the same reason
     every row on this bench is: the words beside the checkbox
     are the part anybody actually points at, so the target is
     the row. That slack sits between the first box and the
     card's own edge, so a uniform `padding: 14px` reads as 14
     at the sides and 23 at the top — the two insets are the
     same number and visibly different amounts of air.

     Taking the slack off the vertical padding makes the four
     look equal, and doing it from the box's CURRENT size means
     it stays equal as the Box knob moves rather than at one
     setting of it. */
  const slack = (ROW - side) / 2;
  const padV = Math.max(0, PAD - slack);

  /* ── where the heap goes ─────────────────────────────────
     Worked out from the bottom up, because that is the order
     it happens in: the last row's slip comes to rest on the
     card's inner edge, and every row above lands on the one
     below. `inset` is the air inside a row that the heap gives
     up — the whole of the fall is three of those. */
  const body = BODY(side, line);
  const inset = (ROW - body) / 2;
  /* every row the card holds, the spare one included */
  const slots = items.length + (spare ? 1 : 0);
  const floor = padV + ROW * slots;
  /* ── and a tilted slip stands on ONE CORNER ─────────────
     The floor is where the LOWEST point of the bottom slip
     comes to rest, not where its middle does. Tilting it drops
     one end below its own centre line, so seating it by the
     centre pushes that corner through the card's edge — 2.9px
     of it, measured. Backing the seat off by the same amount
     puts the corner on the floor, which is what resting on
     something means. */
  /* ── the lean of each slip, from the floor up ───────────
     The bottom one lies flat on the card. Everything above
     inherits what it is lying on and adds its own overhang —
     see LEAN. Zero until the rows have reported their widths,
     which is one frame, and a flat heap for one frame is not
     something anybody sees. */
  const leans = items.map(() => 0);
  for (let i = items.length - 2; i >= 0; i--) {
    const over = Math.max(0, (runs[i] ?? 0) - (runs[i + 1] ?? 0));
    leans[i] = clamp(leans[i + 1] + leanOf(over), 0, MAX_LEAN);
  }
  const touch = gapFor(leans, runs);
  /* the bottom slip is flat, so its lowest point is its own
     edge and the seat needs no correction for a tilt */
  const seat = floor - inset - body;
  const restTop = (i: number) => padV + i * ROW;
  const pileTop = (i: number) => seat - (items.length - 1 - i) * (body + touch);
  const drops = items.map((_, i) => Math.max(0, pileTop(i) - restTop(i)));
  /* the top row travels furthest, so it sets the clock and the
     others are shorter in proportion to it — ONE gravity, and
     t goes as the square root of the distance. That is where
     the cascade comes from now: nothing is delayed, the bottom
     row simply has less far to go and arrives first. */
  const longest = Math.max(...drops, 1);

  const add = () => {
    const text = draft.trim();
    setAdding(false);
    setDraft("");
    if (!text || items.length >= MAX) return;
    setItems((v) => [...v, { text, done: false }]);
  };

  return (
    <div
      className="chk"
      style={{
        width: W,
        /* ── STATED, so it can be animated ─────────────────
           It was whatever the rows added up to. The same
           number, written down, is a number CSS can move
           between — see the transition on .chk. Adding a task
           used to snap the card 40px taller in one frame. */
        height: padV * 2 + ROW * slots,
        padding: `${padV}px ${PAD}px`,
        borderRadius: r,
      }}
    >
      {/* ── AnimatePresence, for the two that leave ─────────
          A reset from five back to three removes two rows, and
          removing them is a blink at the bottom of a card that
          is already closing. Held for a moment and faded
          instead, so the card shuts over them rather than
          them vanishing out from under it. */}
      <AnimatePresence initial={false}>
      {items.map((task, i) => (
        <Row
          /* the TEXT is the key, and two tasks with the same
             words would collide — so it is the text and the
             position it was added at, which nothing reorders */
          key={`${i}-${task.text}`}
          label={task.text}
          on={task.done}
          side={side}
          bounce={bounce}
          still={still}
          fell={fell}
          drop={drops[i]}
          secs={DROP_MS * Math.sqrt(drops[i] / longest)}
          /* the slip is the part of the row you can see, and
             the part that comes to rest on the one below */
          inset={inset}
          drift={DRIFT[i]}
          tilt={leans[i]}
          index={i}
          onRun={measure}
          /* the last thing to land is the top of the heap, and
             it has to be painted like it. DOM order would put
             the bottom row over everything. */
          layer={fell ? items.length - i : undefined}
          onToggle={() => {
            setItems((v) =>
              v.map((t, k) => (k === i ? { ...t, done: !t.done } : t)));
          }}
        />
      ))}
      </AnimatePresence>

      {/* ── the spare row ─────────────────────────────────
          Quiet on purpose: it is the only thing here that is
          not a task, and at full strength a fourth row of ink
          reads as a fourth task you have not ticked. It comes
          up on hover and again while you are typing in it.

          Its own click is stopped, because the card behind
          this block opens the detail overlay on one and the
          field is not a button for the card to recognise. */}
      {spare && (
        <div
          className="chk-add"
          data-hide={fell || undefined}
          style={{ height: ROW }}
          onClick={(e) => e.stopPropagation()}
        >
          <span
            className="chk-ghost"
            aria-hidden="true"
            style={{ width: side, height: side, borderRadius: side * 0.32 }}
          />
          {adding ? (
            <input
              className="chk-field"
              autoFocus
              value={draft}
              placeholder="New task"
              maxLength={40}
              onChange={(e) => setDraft(e.target.value)}
              /* Enter commits, Escape abandons — and neither is
                 allowed past this block: Escape closes the
                 detail overlay, which is not what somebody
                 backing out of a text field is asking for */
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.stopPropagation(); add(); }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setAdding(false);
                  setDraft("");
                }
              }}
              onBlur={add}
            />
          ) : (
            <button
              type="button"
              className="chk-new"
              onClick={() => { setAdding(true); }}
            >
              Add new task
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  on,
  side,
  bounce,
  still,
  fell,
  drop,
  secs,
  inset,
  drift,
  tilt,
  layer,
  index,
  onRun,
  onToggle,
}: {
  label: string;
  on: boolean;
  side: number;
  bounce: number;
  still: boolean;
  /* the list is finished and the floor has gone */
  fell: boolean;
  drop: number;
  secs: number;
  inset: number;
  drift: number;
  tilt: number;
  layer?: number;
  index: number;
  onRun: (i: number, px: number, tall: number) => void;
  onToggle: () => void;
}) {
  /* ── the one number ──────────────────────────────────────
     A component per row rather than a loop, because this is a
     hook and a hook cannot be called three times from the
     parent. It costs nothing at rest: a spring sitting on its
     target runs no loop at all. */
  /* ── it measures its own line and says how long it is ────
     The span is sized to the WORDS rather than the row (see
     .chk-say), so its right edge is where this slip actually
     ends — box, gap and type. Layout effect rather than an
     effect: the parent leans the heap on this number, and a
     frame of the wrong answer is a frame of the wrong heap.
     Re-run on the label and the box size, which are the only
     two things that can change it. */
  const say = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const el = say.current;
    if (el) onRun(index, el.offsetLeft + el.offsetWidth, el.offsetHeight);
  }, [label, side, index, onRun]);

  const t = useSpring(on ? 1 : 0, clamp(bounce, 0, 100), still);
  const held = clamp(t, 0, 1);
  /* the rule's own window on the same number */
  const cut = clamp((held - LAG) / RUN, 0, 1);

  /* ── falling and climbing are not the same motion ────────
     Down is a duration with gravity's shape in it: it starts
     at nothing and gains, which is what `easeIn` is, and the
     small rebound at the end is the difference between landing
     and being placed. Up is a spring, because coming back is
     the list reasserting itself rather than anything being
     dropped — and a spring interrupts cleanly, so unticking a
     task halfway through the fall picks the row up from
     wherever it had got to.

     With motion turned down there is no quieter version of a
     thing falling over, so it does not happen — the same
     answer the celebration this replaced gave. The three
     second reset still runs, so the block still resets. */
  const run = still ? 0 : secs;
  /* a rebound in proportion to the fall — see the constant */
  const up = Math.min(REBOUND, drop * 0.22);
  /* the fall itself, with the rebound as the third keyframe */
  const land = {
    duration: run,
    times: [0, 0.66, 0.84, 1],
    ease: [...FALL_EASE],
  };
  /* the tilt and the sideways drift arrive with the landing
     and do not bounce */
  const lean = { duration: run, ease: "easeIn" as const };

  return (
    <motion.button
      type="button"
      className="chk-row"
      role="checkbox"
      aria-checked={on}
      data-fell={fell || undefined}
      onClick={onToggle}
      style={{ height: ROW, zIndex: layer, "--slip": `${inset}px` } as React.CSSProperties}
      /* the row is drawn where it has always been drawn and
         MOVED from there, so the card's layout never changes
         and the wall's observer never hears about any of this */
      initial={false}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      animate={
        fell
          ? { y: [0, drop, drop - up, drop], x: drift, rotate: tilt }
          : { y: 0, x: 0, rotate: 0 }
      }
      transition={
        fell
          ? { y: land, x: lean, rotate: lean }
          : { type: "spring", stiffness: 380, damping: 34, mass: 0.9 }
      }
    >
      {/* ── the box ───────────────────────────────────────
          Two layers and neither is a border being recoloured:
          the ring is always there and the FILL grows inside
          it. A checkbox that swaps its background is a
          different colour arriving; one whose fill opens from
          the middle is the box being filled in, which is what
          the word means. */}
      <span
        className="chk-box"
        style={{
          width: side,
          height: side,
          borderRadius: side * 0.32,
        }}
      >
        <span
          className="chk-fill"
          style={{
            borderRadius: side * 0.32,
            /* RAW, so it goes past full and settles — this is
               the one place the overshoot belongs */
            transform: `scale(${t.toFixed(4)})`,
          }}
        />
        {/* ── the tick DRAWS ─────────────────────────────
            `pathLength="1"` normalises the dash to the
            stroke's own length, so the offset is a fraction
            rather than a number somebody measured off this
            particular path — change the checkmark and nothing
            here needs to know.

            Clamped, because a tick that overshoots draws
            itself past its own end and pulls back. */}
        <svg className="chk-tick" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M6 12.4 L10.3 16.7 L18 7.6"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - held}
          />
        </svg>
      </span>

      <span className="chk-say" ref={say}>
        {/* the words give up their ink as the rule crosses
            them — read off the same number, so a half-crossed
            line is half-faded and the two can never disagree */}
        <span className="chk-word" style={{ opacity: mix(1, 0.42, held) }}>
          {label}
        </span>
        {/* ── the rule is scaled, not grown ───────────────
            A width in pixels would need the word measured;
            `scaleX` from the left edge needs nothing, and a
            1.5px line has no corner for a scale to distort.
            The span is sized to the WORD rather than the row,
            so the rule stops where the text does. */}
        <span
          className="chk-rule"
          aria-hidden="true"
          style={{ transform: `scaleX(${cut.toFixed(4)})` }}
        />
      </span>
    </motion.button>
  );
}
