export class Input {
  up = false;
  down = false;
  left = false;
  right = false;

  constructor(onFirst: () => void, onToggleView: () => void = () => {}) {
    const set = (code: string, v: boolean) => {
      switch (code) {
        case "KeyW":
        case "ArrowUp":
          this.up = v;
          return true;
        case "KeyS":
        case "ArrowDown":
          this.down = v;
          return true;
        case "KeyA":
        case "ArrowLeft":
          this.left = v;
          return true;
        case "KeyD":
        case "ArrowRight":
          this.right = v;
          return true;
      }
      return false;
    };
    addEventListener("keydown", (e) => {
      onFirst();
      if (e.code === "KeyV" && !e.repeat) onToggleView();
      if (set(e.code, true)) e.preventDefault();
    });
    addEventListener("keyup", (e) => {
      set(e.code, false);
    });
    addEventListener("pointerdown", onFirst);
    addEventListener("blur", () => {
      this.up = this.down = this.left = this.right = false;
    });
  }
}
