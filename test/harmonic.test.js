const { toCamelot, classifyTransition, bpmCompat } = require('../src/harmonic');

describe('Armonía (Camelot)', () => {
  test('Convierte notas estándar a Camelot correctamente', () => {
    expect(toCamelot('am')).toBe('8A');
    expect(toCamelot('C')).toBe('8B');
    expect(toCamelot('F#m')).toBe('11A');
    expect(toCamelot('12A')).toBe('12A');
  });

  test('Clasifica transiciones perfectamente (Perfect, Energy, Mood)', () => {
    const perfect = classifyTransition('8A', '8A');
    expect(perfect.type).toBe('perfect');

    const energyUp = classifyTransition('8A', '9A');
    expect(energyUp.type).toBe('energy_up');

    const mood = classifyTransition('8A', '5A');
    expect(mood.type).toBe('mood');
  });
});

describe('Compatibilidad de BPM', () => {
  test('BPMs cercanos son compatibles', () => {
    const res = bpmCompat(120, 122, 'auto', 6);
    expect(res.compatible).toBe(true);
    expect(res.type).toBe('same');
  });

  test('Doble tiempo (Double-time)', () => {
    const res = bpmCompat(70, 140, 'auto', 6);
    expect(res.compatible).toBe(true);
    expect(res.type).toBe('double');
  });

  test('Modo up_only exige pitch shift positivo (acelerar el track entrante)', () => {
    // Si estoy en 125 y entra uno de 130, tengo que bajarle el pitch a -3.8% (frenarlo). No permitido.
    const resDown = bpmCompat(125, 130, 'up_only', 6);
    expect(resDown.compatible).toBe(false); 

    // Si estoy en 125 y entra uno de 120, tengo que subirle el pitch a +4.1% (acelerarlo). Permitido.
    const resUp = bpmCompat(125, 120, 'up_only', 6);
    expect(resUp.compatible).toBe(true);
  });
});
