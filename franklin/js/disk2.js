'use strict';
// Disk II controller (slot 6) emulation: DOS 3.3 6-and-2 nibblization plus the
// soft-switch interface the boot PROM and DOS's RWTS talk to.
//
// The 6-and-2 encoding (TRANS62 table, fourXfour address-field encoding, the
// 342-byte primary/secondary split) is the standard DOS 3.3 nibble format.
// TRANS62 was cross-checked two ways: it matches the table the real Disk II
// boot PROM builds at runtime (verified by executing the ROM itself against
// this project's 6502 core), and it matches the public apple2js emulator's
// implementation byte-for-byte.

const TRANS62 = [
  0x96, 0x97, 0x9a, 0x9b, 0x9d, 0x9e, 0x9f, 0xa6,
  0xa7, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc,
  0xbd, 0xbe, 0xbf, 0xcb, 0xcd, 0xce, 0xcf, 0xd3,
  0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde,
  0xdf, 0xe5, 0xe6, 0xe7, 0xe9, 0xea, 0xeb, 0xec,
  0xed, 0xee, 0xef, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6,
  0xf7, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
];

// Standard DOS 3.3 logical<->physical sector skew table (the same table DOS's
// own boot1 embeds at the end of Track 0 Sector 0).
const DOS_SKEW = [0, 13, 11, 9, 7, 5, 3, 1, 14, 12, 10, 8, 6, 4, 2, 15];

function fourXfour(val) {
  let xx = val & 0xaa;
  let yy = val & 0x55;
  xx >>= 1;
  xx |= 0xaa;
  yy |= 0xaa;
  return [xx, yy];
}

function nibblizeSector(volume, track, sector, data /* 256 bytes */) {
  const buf = [];
  const gap = sector === 0 ? 0x80 : (track === 0 ? 0x28 : 0x26);
  for (let i = 0; i < gap; i++) buf.push(0xff);

  const checksum = volume ^ track ^ sector;
  buf.push(0xd5, 0xaa, 0x96);
  buf.push(...fourXfour(volume));
  buf.push(...fourXfour(track));
  buf.push(...fourXfour(sector));
  buf.push(...fourXfour(checksum));
  buf.push(0xde, 0xaa, 0xeb);

  for (let i = 0; i < 5; i++) buf.push(0xff);

  buf.push(0xd5, 0xaa, 0xad);

  const nibbles = new Uint8Array(0x156);
  const ptr6 = 0x56;
  let idx2 = 0x55;
  for (let idx6 = 0x101; idx6 >= 0; idx6--) {
    let val6 = data[idx6 % 0x100];
    let val2 = nibbles[idx2];
    val2 = (val2 << 1) | (val6 & 1);
    val6 >>= 1;
    val2 = (val2 << 1) | (val6 & 1);
    val6 >>= 1;
    nibbles[ptr6 + idx6] = val6;
    nibbles[idx2] = val2;
    if (--idx2 < 0) idx2 = 0x55;
  }

  let last = 0;
  for (let i = 0; i < 0x156; i++) {
    const val = nibbles[i];
    buf.push(TRANS62[last ^ val]);
    last = val;
  }
  buf.push(TRANS62[last]);

  buf.push(0xde, 0xaa, 0xeb);
  buf.push(0xff);

  return buf;
}

// diskBytes: Uint8Array of length 35*16*256, DOS-order (.do format).
// Returns an array of 35 Uint8Array tracks, each the nibblized byte stream
// a real drive head would see going around that track once.
function nibblizeDosOrderDisk(diskBytes, volume) {
  volume = volume == null ? 0xfe : volume;
  const tracks = [];
  for (let t = 0; t < 35; t++) {
    let trackBuf = [];
    for (let physSector = 0; physSector < 16; physSector++) {
      const logicalSector = DOS_SKEW[physSector];
      const off = t * 16 * 256 + logicalSector * 256;
      const data = diskBytes.subarray(off, off + 256);
      trackBuf = trackBuf.concat(nibblizeSector(volume, t, physSector, data));
    }
    tracks.push(Uint8Array.from(trackBuf));
  }
  return tracks;
}

// A new nibble becomes available roughly every 32 CPU cycles on real Disk II
// hardware -- a figure baked into RWTS's tightly hand-timed read loops. An
// "always ready" latch lets those loops finish in far fewer iterations than
// real hardware, which throws off anything that counts elapsed poll cycles
// (DOS's own boot loader does exactly this while waiting for the drive
// motor/head to settle), so the latch is paced against the CPU's own cycle
// counter instead.
const CYCLES_PER_NIBBLE = 32;

// Emulates one Disk II drive on a given slot's soft-switch page ($C0n0-$C0nF).
// Only read support is implemented -- sufficient to boot and run software
// from a supplied disk image; write soft switches are accepted but no-ops.
class Disk2Drive {
  constructor() {
    this.tracks = null; // array of 35 Uint8Array, or null if no disk loaded
    this.halftrack = 0; // 0-69; track = halftrack >> 1
    this.curPhase = 0;
    this.phaseState = 0;
    this.pos = 0; // nibble read position within the current track
    this.currentByte = 0;
    this.lastByteCycle = 0;
  }
  get track() { return Math.min(34, this.halftrack >> 1); }
  loadDisk(diskBytes, volume) {
    this.tracks = nibblizeDosOrderDisk(diskBytes, volume);
    this.halftrack = 0;
    this.curPhase = 0;
    this.pos = 0;
    this.lastByteCycle = 0;
  }
  setPhase(phase, on) {
    if (!on) { this.phaseState &= ~(1 << phase); return; }
    this.phaseState |= (1 << phase);
    let delta = phase - this.curPhase;
    delta = ((delta + 2) % 4 + 4) % 4 - 2; // normalize to {-1, 0, 1, 2}
    if (delta === 1) this.halftrack = Math.min(69, this.halftrack + 1);
    else if (delta === -1) this.halftrack = Math.max(0, this.halftrack - 1);
    this.curPhase = phase;
  }
  readLatch(cpuCycles) {
    if (!this.tracks) return 0xff;
    const t = this.tracks[this.track];
    const elapsed = cpuCycles - this.lastByteCycle;
    if (elapsed < CYCLES_PER_NIBBLE) {
      // Not time for a new byte yet -- report "not ready" (bit7 clear) so a
      // polling loop keeps spinning, same as real hardware.
      return this.currentByte & 0x7f;
    }
    const advance = Math.floor(elapsed / CYCLES_PER_NIBBLE);
    this.pos = (this.pos + advance) % t.length;
    this.lastByteCycle += advance * CYCLES_PER_NIBBLE;
    this.currentByte = t[this.pos];
    return this.currentByte;
  }
}

class Disk2Controller {
  constructor() {
    this.drives = [new Disk2Drive(), new Disk2Drive()];
    this.selected = 0;
    this.motorOn = false;
    this.q6 = 0; // Q6L/Q6H
    this.q7 = 0; // Q7L/Q7H (0 = read mode, 1 = write mode)
  }
  get drive() { return this.drives[this.selected]; }
  loadDisk(diskBytes, driveIndex, volume) {
    this.drives[driveIndex == null ? 0 : driveIndex].loadDisk(diskBytes, volume);
  }
  // addrLow is the low nibble ($C0E0-$C0EF for slot 6, or the equivalent for
  // any slot after masking to its 16-entry page). Reads and writes to these
  // soft switches have the same effect on real hardware, so callers don't
  // need to distinguish them. cpuCycles paces the read latch against real
  // elapsed time (see CYCLES_PER_NIBBLE above).
  access(addrLow, cpuCycles) {
    const a = addrLow & 0xf;
    if (a <= 7) { this.drive.setPhase(a >> 1, (a & 1) === 1); return 0; }
    if (a === 0x8) { this.motorOn = false; return 0; }
    if (a === 0x9) { this.motorOn = true; return 0; }
    if (a === 0xA) { this.selected = 0; return 0; }
    if (a === 0xB) { this.selected = 1; return 0; }
    if (a === 0xC) { // Q6L
      this.q6 = 0;
      if (this.q7 === 0) return this.drive.readLatch(cpuCycles);
      return 0;
    }
    if (a === 0xD) { // Q6H
      this.q6 = 1;
      return 0; // write-protect sense: report "not protected"
    }
    if (a === 0xE) { this.q7 = 0; return 0; } // Q7L: read mode
    if (a === 0xF) { this.q7 = 1; return 0; } // Q7H: write mode
    return 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Disk2Controller, nibblizeDosOrderDisk, nibblizeSector, TRANS62, DOS_SKEW, fourXfour };
}
