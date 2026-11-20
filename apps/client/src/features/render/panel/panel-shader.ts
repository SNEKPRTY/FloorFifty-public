/**
 * The LCD panel's fragment shader.
 *
 * Ported from `lcd-perfect v10`:
 *
 *   Copyright (c) 2026 sinedied, MIT licence.
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the "Software"),
 *   to deal in the Software without restriction, including without limitation
 *   the rights to use, copy, modify, merge, publish, distribute, sublicense,
 *   and/or sell copies of the Software, and to permit persons to whom the
 *   Software is furnished to do so, subject to the following conditions: the
 *   above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED
 *   "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What this port changed, and why:
 *
 * - The cell pitch comes from uniforms instead of `InputSize / OutputSize`.
 *   Upstream scales a low-resolution source to the display; this pass runs at
 *   renderer resolution, so its pitch has to be anchored to the game's logical
 *   grid explicitly. That is what lets the HUD keep its full resolution.
 *   `uCellSize` is the grid's size in CSS pixels and `uCells` its period; the
 *   frequency the band-limiting needs is a different pixel again -- a device
 *   one -- so it arrives separately as `uCyclesPerPixel`, with the Nyquist fade
 *   already applied to it as `uFade`. Both are constant across a frame, so
 *   deriving them here would only be a second copy of `panel-options.ts`.
 * - Upstream's pixel-perfect scaler is removed -- `B`, `Bt`, `AB`, `Alo` and
 *   `w`. Every one of them exists to place the transition between two source
 *   texels on the mesh's dark line, and there is no upscale left to perform.
 *   The port samples `vTextureCoord` directly.
 * - `balance` is the share given to ROWS here, the reverse of upstream's
 *   ordering. Upstream's own parameter block disagrees with its header comment
 *   about which axis it drives; this is the reading that makes 0.60 mean
 *   "row-dominant, like a real panel", which is what the header was after.
 * - Chromatic aberration, halation and scanlines are additions. Scanlines are
 *   an amplitude on the row axis rather than a pattern of their own, so they
 *   inherit the box filter and the Nyquist fade instead of fighting them.
 *
 * The band-limiting is upstream's and is the reason any of this holds up: the
 * mesh is a sinusoid integrated exactly over each output pixel's footprint
 * rather than sampled at its centre, and it is faded out past Nyquist rather
 * than left to fold into a coarser pattern at nearly full strength.
 */

export const PANEL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;

uniform float uCellSize;
uniform float uCells;
uniform float uCyclesPerPixel;
uniform float uFade;
uniform float uGrid;
uniform float uBalance;
uniform float uSubpixels;
uniform float uLayout;
uniform float uScanlines;
uniform float uAberration;
uniform float uGlow;
uniform float uGlowThreshold;
uniform float uGlowRadius;
uniform float uBrightness;
uniform float uGamma;

#define TAU 6.283185307
#define PI  3.141592654

// cos and sin of TAU/6, the angle from a cell's centre to the red stripe.
// Green sits half a turn from there, so its pair is (-1, 0) and costs nothing.
#define COS_TAU_6 0.5
#define SIN_TAU_6 0.866025404

// Mean of a unit sinusoid over one output pixel. The mesh gets this exactly
// from the integral below; the stripes are sampled, so they need it named.
float boxSinc(float f) {
    float x = PI * max(f, 1e-4);
    return sin(x) / x;
}

// Every tap is clamped to the pass's own frame. The pool hands out a texture
// larger than the frame, so an unclamped offset would read whatever the last
// tenant left there. Note the frame INCLUDES the padding, which is transparent
// wherever the scene does not reach, so an edge tap can still pull in nothing:
// that costs a fraction of a pixel of fringe at the extreme canvas edge and is
// cheaper than a second clamp that would have to know where the scene ends.
vec4 tap(vec2 coord) {
    return texture(uTexture, clamp(coord, uInputClamp.xy, uInputClamp.zw));
}

void main() {
    vec2 texel = 1.0 / uInputSize.xy;

    // The pattern coordinate, in logical units. Anchored to the input texture
    // rather than the output frame: with \`filterArea\` pinned to the canvas the
    // two differ by the padding alone, which is constant, so the mesh's phase
    // is fixed and cannot crawl as the world's bounds change.
    vec2 p = vTextureCoord * uInputSize.xy / uCellSize;

    // Cycles per OUTPUT pixel, and the Nyquist fade that follows from it. The
    // pixel here is a DEVICE one, not the CSS pixel \`uCellSize\` is measured in:
    // this program runs once per device pixel, so that is the footprint the box
    // filter integrates over and the rate Nyquist is measured against.
    float f = uCyclesPerPixel;
    float fade = uFade;

    // -- chromatic aberration ------------------------------------------------
    // Offsets are in logical units, so the split is the same fraction of a game
    // pixel at every viewport rather than of a device pixel.
    vec2 split = vec2(uAberration * uCellSize, 0.0) * texel;
    vec4 centre = tap(vTextureCoord);
    vec3 color = vec3(tap(vTextureCoord + split).r, centre.g, tap(vTextureCoord - split).b);

    // -- halation ------------------------------------------------------------
    // Added BEFORE the mesh multiply, so a bright sprite lights the grid lines
    // rather than merely failing to darken them. That is the whole difference
    // between reading as backlit and reading as a grid over a picture.
    if (uGlow > 0.0) {
        vec2 r = vec2(uGlowRadius * uCellSize) * texel;
        vec3 bleed = 0.25 * (
            tap(vTextureCoord + vec2( r.x,  r.y)).rgb +
            tap(vTextureCoord + vec2(-r.x,  r.y)).rgb +
            tap(vTextureCoord + vec2( r.x, -r.y)).rgb +
            tap(vTextureCoord + vec2(-r.x, -r.y)).rgb
        );
        float luma = dot(bleed, vec3(0.2126, 0.7152, 0.0722));
        color += uGlow * max(0.0, luma - uGlowThreshold) * bleed;
    }

    // -- the mesh ------------------------------------------------------------
    // x drives the horizontal axis, so it makes columns; y makes rows. Scanlines
    // are an amplitude on the row axis, which is why they need no maths of their
    // own and cannot disagree with the mesh about where a dark line falls.
    //
    // Once a period spans several cells only one cell boundary in \`uCells\`
    // carries a line, so the amplitude is spread back out over the rest. A
    // period of one cell is untouched.
    vec2 amp = clamp(uGrid * 2.0 * vec2(1.0 - uBalance, uBalance) + vec2(0.0, uScanlines), 0.0, 1.0)
               * fade * (2.0 / (uCells + 1.0));

    // Half an output pixel, in cycles: puts one sample per cycle on the trough,
    // which is what lets a two-pixel pitch resolve at all.
    float phase = 0.5 * f;
    vec2  t     = p / uCells;
    float hh    = 0.4995 * f;

    // The aperture integral over the footprint, the exact box filter. Both ends
    // are symmetric about X, so one sin and one cos of X do the work of four
    // and the stripes below reuse the pair.
    vec2  X    = TAU * (t - phase);
    vec2  sinX = sin(X);
    vec2  cosX = cos(X);
    float sinY = sin(TAU * hh);
    vec2  k    = amp / TAU;

    vec2 I = max(2.0 * hh - k * (2.0 * cosX * sinY), 1e-6);

    // Peak-normalised, so the flat top lands at 1 and nothing meets the clamp.
    vec2 g = I * (1.0 / (2.0 * hh * (1.0 + amp)));
    float gain = g.x * g.y;

    // -- RGB stripes ---------------------------------------------------------
    // Three sinusoids 120 degrees apart, summing to exactly 3 at every pixel,
    // so they are luminance neutral and blue costs no third cosine.
    vec3 stripe = vec3(1.0);
    if (uSubpixels > 0.0) {
        float sinc = boxSinc(f);
        float ac = uSubpixels * sinc * fade;
        vec2 rg = 1.0 + ac * vec2(COS_TAU_6 * cosX.x + SIN_TAU_6 * sinX.x, -cosX.x);
        stripe = vec3(rg, 3.0 - rg.x - rg.y);

        // A column mesh and the stripes share a pitch, so whichever stripe lands
        // on the dark line is dimmed. Divide the cast back out; M must be the
        // BOX-FILTERED amplitude or it overshoots where the filter bites.
        float M = amp.x * sinc;
        vec3 corr = 1.0 - 0.5 * M * ac * vec3(COS_TAU_6, -1.0, COS_TAU_6);
        // The sqrt below halves any deviation on the way to the encoded value,
        // so the correction is halved here to match.
        stripe /= sqrt(max(corr, vec3(1e-3)));

        if (uLayout >= 0.5) stripe = stripe.bgr;
    }

    // -- output --------------------------------------------------------------
    // Treating the encoding as a gamma of 2 makes sqrt(linear * m) equal
    // encoded * sqrt(m), so one square root replaces the decode and re-encode.
    // Brightness rides the pattern, so the clamp lands on the product.
    vec3 m = sqrt(max(stripe * (gain * uBrightness), 0.0));

    // The base is clamped because pow(0, g) is undefined and returns NaN on real
    // drivers. 1e-8, not 1e-5, which would lift pure black to 1/255.
    if (abs(uGamma - 1.0) > 0.001) {
        color = pow(max(color, vec3(1e-8)), vec3(uGamma));
    }

    // Alpha is carried through rather than forced to 1. Pixi composites filter
    // output premultiplied, and the scene is not opaque everywhere the padded
    // filter area reaches.
    finalColor = vec4(clamp(color * m, 0.0, 1.0), centre.a);
}
`;
