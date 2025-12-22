export class Utils {
  // Generically shuffle arrays in-place using Durstenfeld's shuffling algorithm
  static shuffleArray<T>(array: T[]): T[] {
    // console.log(`[Utils] 🎲 shuffleArray called with size ${array?.length}`);
    for (let i = array.length - 1; i >= 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]]; // perform the swap
    }
    return array;
  }
}
