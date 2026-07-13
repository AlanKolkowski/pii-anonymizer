import { createRng } from './rng.mjs';
import {
  peselChecksumValid, nipChecksumValid, regon9ChecksumValid, regon14ChecksumValid, ibanChecksumValid,
  generatePesel, generateNip, generateRegon9, generateRegon14, generateIban, generateVin,
} from './checksums.mjs';
// Cross-check against the app's own detector so generated identifiers are
// proven to validate against the real thing, not just against a second copy
// of the same formula.
import { findRegexEntities } from '../../src/anonymizer.js';

function manyRng(seedPrefix, n) {
  return Array.from({ length: n }, (_, i) => createRng(`${seedPrefix}/${i}`));
}

describe('generatePesel', () => {
  it('always produces an 11-digit string that passes its own checksum', () => {
    for (const rng of manyRng('pesel', 200)) {
      const p = generatePesel(rng);
      expect(p).toMatch(/^\d{11}$/);
      expect(peselChecksumValid(p)).toBe(true);
    }
  });

  it('is deterministic for a given seed', () => {
    expect(generatePesel(createRng('pesel/fixed'))).toBe(generatePesel(createRng('pesel/fixed')));
  });

  it('mutating the check digit invalidates it (negative control)', () => {
    const p = generatePesel(createRng('pesel/mutate'));
    const mutated = p.slice(0, 10) + String((Number(p[10]) + 1) % 10);
    expect(peselChecksumValid(mutated)).toBe(false);
  });

  it('is detected by the app as PERSON_IDENTIFIER with score 1.0', () => {
    for (const rng of manyRng('pesel-detect', 30)) {
      const p = generatePesel(rng);
      const text = `Dłużnik, PESEL ${p}, zamieszkały w Warszawie.`;
      const entities = findRegexEntities(text);
      const hit = entities.find((e) => text.slice(e.start, e.end).replace(/\D/g, '') === p);
      expect(hit, `PESEL ${p} not detected in "${text}"`).toBeTruthy();
      expect(hit.entity_group).toBe('PERSON_IDENTIFIER');
      expect(hit.score).toBe(1.0);
    }
  });
});

describe('generateNip', () => {
  it('always produces a 10-digit string that passes its own checksum', () => {
    for (const rng of manyRng('nip', 200)) {
      const n = generateNip(rng);
      expect(n).toMatch(/^\d{10}$/);
      expect(nipChecksumValid(n)).toBe(true);
    }
  });

  it('is deterministic for a given seed', () => {
    expect(generateNip(createRng('nip/fixed'))).toBe(generateNip(createRng('nip/fixed')));
  });

  it('mutating the check digit invalidates it', () => {
    const n = generateNip(createRng('nip/mutate'));
    const mutated = n.slice(0, 9) + String((Number(n[9]) + 1) % 10);
    expect(nipChecksumValid(mutated)).toBe(false);
  });

  it('is detected by the app as ORGANIZATION_IDENTIFIER with score 1.0', () => {
    for (const rng of manyRng('nip-detect', 30)) {
      const n = generateNip(rng);
      const text = `Sprzedawca, NIP ${n}, z siedzibą w Poznaniu.`;
      const entities = findRegexEntities(text);
      const hit = entities.find((e) => text.slice(e.start, e.end).replace(/\D/g, '') === n);
      expect(hit, `NIP ${n} not detected in "${text}"`).toBeTruthy();
      expect(hit.entity_group).toBe('ORGANIZATION_IDENTIFIER');
      expect(hit.score).toBe(1.0);
    }
  });
});

describe('generateRegon9', () => {
  it('always produces a 9-digit string that passes its own checksum', () => {
    for (const rng of manyRng('regon9', 200)) {
      const r = generateRegon9(rng);
      expect(r).toMatch(/^\d{9}$/);
      expect(regon9ChecksumValid(r)).toBe(true);
    }
  });

  it('mutating the check digit invalidates it', () => {
    const r = generateRegon9(createRng('regon9/mutate'));
    const mutated = r.slice(0, 8) + String((Number(r[8]) + 1) % 10);
    expect(regon9ChecksumValid(mutated)).toBe(false);
  });

  it('is detected by the app as ORGANIZATION_IDENTIFIER with score 1.0', () => {
    for (const rng of manyRng('regon9-detect', 30)) {
      const r = generateRegon9(rng);
      const text = `Spółka, REGON ${r}, wpisana do rejestru.`;
      const entities = findRegexEntities(text);
      const hit = entities.find((e) => text.slice(e.start, e.end).replace(/\D/g, '') === r);
      expect(hit, `REGON9 ${r} not detected in "${text}"`).toBeTruthy();
      expect(hit.entity_group).toBe('ORGANIZATION_IDENTIFIER');
    }
  });
});

describe('generateRegon14', () => {
  it('always produces a 14-digit string that passes both its own checksum and nests a valid REGON-9', () => {
    for (const rng of manyRng('regon14', 200)) {
      const r = generateRegon14(rng);
      expect(r).toMatch(/^\d{14}$/);
      expect(regon14ChecksumValid(r)).toBe(true);
      expect(regon9ChecksumValid(r.slice(0, 9))).toBe(true);
    }
  });

  it('mutating the final check digit invalidates it', () => {
    const r = generateRegon14(createRng('regon14/mutate'));
    const mutated = r.slice(0, 13) + String((Number(r[13]) + 1) % 10);
    expect(regon14ChecksumValid(mutated)).toBe(false);
  });

  it('is detected by the app as ORGANIZATION_IDENTIFIER with score 1.0', () => {
    for (const rng of manyRng('regon14-detect', 30)) {
      const r = generateRegon14(rng);
      const text = `Oddział, REGON ${r}, samobilansujący.`;
      const entities = findRegexEntities(text);
      const hit = entities.find((e) => text.slice(e.start, e.end).replace(/\D/g, '') === r);
      expect(hit, `REGON14 ${r} not detected in "${text}"`).toBeTruthy();
      expect(hit.entity_group).toBe('ORGANIZATION_IDENTIFIER');
    }
  });
});

describe('generateIban', () => {
  it('always produces a valid Polish IBAN (mod-97) and matching 26-digit NRB', () => {
    for (const rng of manyRng('iban', 200)) {
      const { iban, nrb } = generateIban(rng);
      expect(iban).toMatch(/^PL\d{26}$/);
      expect(nrb).toMatch(/^\d{26}$/);
      expect(iban).toBe(`PL${nrb}`);
      expect(ibanChecksumValid(iban)).toBe(true);
    }
  });

  it('mutating a digit invalidates the checksum', () => {
    const { iban } = generateIban(createRng('iban/mutate'));
    const mutated = iban.slice(0, 10) + String((Number(iban[10]) + 1) % 10) + iban.slice(11);
    expect(ibanChecksumValid(mutated)).toBe(false);
  });

  it('is detected by the app as BANK_ACCOUNT_IDENTIFIER with score 1.0 (both PL-prefixed and bare NRB)', () => {
    for (const rng of manyRng('iban-detect', 30)) {
      const { iban, nrb } = generateIban(rng);
      const textIban = `Rachunek: ${iban}.`;
      const hitIban = findRegexEntities(textIban).find((e) => e.entity_group === 'BANK_ACCOUNT_IDENTIFIER');
      expect(hitIban, `IBAN ${iban} not detected`).toBeTruthy();
      expect(hitIban.score).toBe(1.0);

      const textNrb = `Rachunek krajowy: ${nrb} (bez prefiksu).`;
      const hitNrb = findRegexEntities(textNrb).find((e) => e.entity_group === 'BANK_ACCOUNT_IDENTIFIER');
      expect(hitNrb, `bare NRB ${nrb} not detected`).toBeTruthy();
    }
  });
});

describe('generateVin', () => {
  it('produces a 17-char string in the VIN alphabet (no I/O/Q) with at least one letter and one digit', () => {
    for (const rng of manyRng('vin', 200)) {
      const vin = generateVin(rng);
      expect(vin.length).toBe(17);
      expect(/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)).toBe(true);
      expect(/\d/.test(vin)).toBe(true);
      expect(/[A-Z]/.test(vin)).toBe(true);
    }
  });

  it('is detected by the app as VEHICLE_IDENTIFIER with score 1.0', () => {
    for (const rng of manyRng('vin-detect', 30)) {
      const vin = generateVin(rng);
      const text = `pojazd marki Astra, VIN ${vin}, rok prod. 2018.`;
      const hit = findRegexEntities(text).find((e) => e.entity_group === 'VEHICLE_IDENTIFIER');
      expect(hit, `VIN ${vin} not detected in "${text}"`).toBeTruthy();
      expect(hit.score).toBe(1.0);
    }
  });
});

describe('cross-family disjointness (identifiers never collide across a large sample)', () => {
  it('200 generated PESELs, NIPs, and IBANs are all pairwise distinct within their own family', () => {
    const pesels = manyRng('collision-pesel', 200).map((r) => generatePesel(r));
    const nips = manyRng('collision-nip', 200).map((r) => generateNip(r));
    const ibans = manyRng('collision-iban', 200).map((r) => generateIban(r).iban);
    expect(new Set(pesels).size).toBe(pesels.length);
    expect(new Set(nips).size).toBe(nips.length);
    expect(new Set(ibans).size).toBe(ibans.length);
  });
});
