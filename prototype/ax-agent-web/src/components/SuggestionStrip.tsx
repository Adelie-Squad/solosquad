import { useEffect, useRef, useState } from 'react';
import type { SuggestedPrompt } from '../data/dummy';

interface Props {
  prompts: SuggestedPrompt[];
  onPick: (text: string) => void;
}

/**
 * 추천 프롬프트 한 줄. 입력창과 같은 폭에서 좌우로 잘리고,
 * 가려진 항목이 있는 쪽 끝만 그라데이션으로 사라진다.
 * 세로 휠도 가로 스크롤로 바꿔 준다.
 */
export function SuggestionStrip({ prompts, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [fadeLeft, setFadeLeft] = useState(false);
  const [fadeRight, setFadeRight] = useState(false);

  const updateFades = () => {
    const el = ref.current;
    if (!el) return;
    setFadeLeft(el.scrollLeft > 1);
    setFadeRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    updateFades();

    // React 의 onWheel 은 passive 라 preventDefault 가 안 된다 — 직접 등록
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // 트랙패드 가로 제스처는 그대로
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    const resize = new ResizeObserver(updateFades);
    el.addEventListener('wheel', onWheel, { passive: false });
    resize.observe(el);
    return () => {
      el.removeEventListener('wheel', onWheel);
      resize.disconnect();
    };
  }, []);

  const fadeClass = [fadeLeft && 'fade-left', fadeRight && 'fade-right'].filter(Boolean).join(' ');

  return (
    <div ref={ref} className={`suggestions ${fadeClass}`} onScroll={updateFades} aria-label="추천 요청">
      {prompts.map((p) => (
        <button key={p.id} className="suggestion" onClick={() => onPick(p.text)}>
          <span>{p.icon}</span> {p.text}
        </button>
      ))}
    </div>
  );
}
