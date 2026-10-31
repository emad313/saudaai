// Lives inside the shadow root, so host page styles cannot leak in and ours cannot leak out.
export const css = (color: string) => `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, 'Noto Sans Bengali', 'Hind Siliguri', sans-serif; }
[hidden] { display: none !important; }
svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
button { cursor: pointer; font: inherit; }
button:focus-visible, input:focus-visible { outline: 2px solid ${color}; outline-offset: 2px; }
.bubble {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  width: 58px; height: 58px; border-radius: 50%; border: 0;
  background: ${color}; color: #fff; display: grid; place-items: center;
  box-shadow: 0 8px 24px rgb(29 38 48 / .25);
}
.bubble svg { width: 26px; height: 26px; }
.panel {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  width: 370px; height: min(600px, calc(100vh - 40px));
  display: flex; flex-direction: column; overflow: hidden;
  background: #f6f8fa; color: #1d2630; font-size: 15px; line-height: 1.45;
  border-radius: 16px; box-shadow: 0 16px 48px rgb(29 38 48 / .22);
}
@media (max-width: 480px) { .panel { inset: 0; width: auto; height: auto; border-radius: 0; } }
header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: ${color}; color: #fff; }
.avatar { width: 38px; height: 38px; border-radius: 50%; background: rgb(255 255 255 / .2); display: grid; place-items: center; }
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.who strong { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who small { font-size: 12px; opacity: .85; }
.close { border: 0; background: transparent; color: #fff; padding: 6px; border-radius: 8px; }
.log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.hint { margin: 0; padding: 10px 12px; background: #fff; border-radius: 12px; color: #6b7785; font-size: 14px; }
.msg { max-width: 85%; padding: 8px 12px; border-radius: 14px; word-wrap: break-word; }
.msg p { margin: 0; white-space: pre-wrap; }
.msg img { display: block; max-width: 100%; max-height: 260px; border-radius: 10px; margin-bottom: 4px; }
.mine { align-self: flex-end; background: ${color}; color: #fff; border-bottom-right-radius: 4px; }
.theirs { align-self: flex-start; background: #fff; border: 1px solid #e8ecf1; border-bottom-left-radius: 4px; }
.quick { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.quick button { border: 1px solid ${color}; color: ${color}; background: #fff; border-radius: 999px; padding: 4px 12px; font-size: 14px; }
.typing { align-self: flex-start; display: flex; gap: 4px; padding: 12px 14px; background: #fff; border-radius: 14px; }
.typing i { width: 6px; height: 6px; border-radius: 50%; background: #6b7785; animation: blink 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .2s; } .typing i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 60%, 100% { opacity: .25; } 30% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .typing i { animation: none; } }
.error { margin: 0; padding: 6px 14px; color: #e04b4b; font-size: 13px; }
.composer { display: flex; align-items: center; gap: 8px; padding: 10px; background: #fff; border-top: 1px solid #e8ecf1; }
.composer input { flex: 1; min-width: 0; height: 42px; padding: 0 14px; border: 1px solid #e8ecf1; border-radius: 999px; font: inherit; color: inherit; outline: none; }
.round { width: 42px; height: 42px; flex: none; border-radius: 50%; border: 1px solid #e8ecf1; background: #fff; color: #6b7785; display: grid; place-items: center; }
.round.live { background: #e04b4b; border-color: #e04b4b; color: #fff; }
.send { background: ${color}; border-color: ${color}; color: #fff; }
`
