'use strict';
// Franklin Ace 1000 (Apple II+-compatible) machine: memory map, soft
// switches, and the glue between the 6502 core and the Disk II controller.

const CPU_HZ = 1021800; // NTSC Apple II master clock / 14, standard II+ rate

class Machine {
  constructor() {
    this.ram = new Uint8Array(0xC000);      // $0000-$BFFF, 48K
    this.rom = decodeSystemRom();           // $D000-$FFFF, 12K
    this.disk2Rom = decodeDisk2BootRom();   // $C600-$C6FF (slot 6)
    this.disk2 = new Disk2Controller();

    this.keyLatch = 0x00;   // $C000: bit7 set + ASCII when a key is waiting
    this.anyKeyDown = false;

    this.textMode = true;
    this.mixedMode = false;
    this.page2 = false;
    this.hires = false;

    this.cpu = new M6502();
    this.cpu.read = (addr) => this.read(addr);
    this.cpu.write = (addr, val) => this.write(addr, val);
  }

  loadDefaultBootDisk() {
    this.disk2.loadDisk(decodeDefaultBootDisk(), 0);
  }

  loadDiskImage(bytes, driveIndex) {
    this.disk2.loadDisk(bytes, driveIndex == null ? 0 : driveIndex);
  }

  // Power-on: RAM contents are unpredictable on real hardware, but the
  // Autostart ROM only recognizes a "warm start" if a specific magic byte
  // pattern happens to already sit at $03F2-$03F4 -- so zeroing RAM makes
  // every power-on deterministically take the cold-start path, same as real
  // hardware does in all but astronomically unlucky cases.
  powerOn() {
    this.ram.fill(0);
    this.keyLatch = 0;
    this.textMode = true;
    this.mixedMode = false;
    this.page2 = false;
    this.hires = false;
    this.cpu.reset();
  }

  // Mimics the Ctrl-RESET key: pulses the CPU's reset line without touching
  // memory, so a program's own warm-start vector (if any) can take over.
  resetButton() {
    this.cpu.reset();
  }

  keyDown(asciiCode) {
    this.keyLatch = 0x80 | (asciiCode & 0x7f);
    this.anyKeyDown = true;
  }
  keyUp() {
    this.anyKeyDown = false;
  }

  ioAccess(addr) {
    const a = addr & 0xff;
    if (a === 0x00) return this.keyLatch;
    if (a === 0x10) { this.keyLatch &= 0x7f; return this.anyKeyDown ? 0x80 : 0x00; }
    if (a === 0x50) { this.textMode = false; return 0; }
    if (a === 0x51) { this.textMode = true; return 0; }
    if (a === 0x52) { this.mixedMode = false; return 0; }
    if (a === 0x53) { this.mixedMode = true; return 0; }
    if (a === 0x54) { this.page2 = false; return 0; }
    if (a === 0x55) { this.page2 = true; return 0; }
    if (a === 0x56) { this.hires = false; return 0; }
    if (a === 0x57) { this.hires = true; return 0; }
    if (a >= 0xe0 && a <= 0xef) return this.disk2.access(a, this.cpu.cycles);
    return 0x00; // speaker, cassette, utility strobe, paddles, other slots
  }

  read(addr) {
    addr &= 0xffff;
    if (addr < 0xC000) return this.ram[addr];
    if (addr >= 0xD000) return this.rom[addr - 0xD000];
    if (addr < 0xC100) return this.ioAccess(addr);
    if (addr >= 0xC600 && addr <= 0xC6FF) return this.disk2Rom[addr - 0xC600];
    return 0x00; // unpopulated peripheral/expansion ROM space
  }

  write(addr, val) {
    addr &= 0xffff;
    val &= 0xff;
    if (addr < 0xC000) { this.ram[addr] = val; return; }
    if (addr < 0xC100) { this.ioAccess(addr); return; }
    // ROM and unpopulated slot space: read-only, writes have no effect.
  }

  // Runs approximately one frame's worth of CPU cycles (1/60s of real time).
  runFrame() {
    const target = this.cpu.cycles + Math.round(CPU_HZ / 60);
    while (this.cpu.cycles < target) this.cpu.step();
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Machine, CPU_HZ };
