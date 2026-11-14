import { useState } from "react";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AlbumCarousel } from "@/components/AlbumCarousel";
import { EmojiReactions } from "@/components/EmojiReactions";
import { albumReactionPhoto } from "./photoReactionState";

vi.mock("@/components/LazyImage", () => ({ LazyImage: () => null }));
afterEach(cleanup);

it("swiping an album changes the real reaction controls' write target to the visible photo", () => {
  const write = vi.fn();
  const cover = { id: "cover", _albumPhotos: [{ id: "first" }, { id: "second" }] };
  function Album() {
    const [index, setIndex] = useState(0);
    const target = albumReactionPhoto(cover, index);
    return <>
      <AlbumCarousel photos={cover._albumPhotos} onIndexChange={setIndex} />
      <EmojiReactions key={target.id} currentUserId="paul" reactions={[]} onReact={type => write(target.id, type)} onRemove={() => write(target.id, null)} />
    </>;
  }
  const { container } = render(<Album />);
  const scroller = container.querySelector(".snap-x");
  if (!scroller) throw new Error("Album scroller missing");
  Object.defineProperty(scroller, "clientWidth", { value: 320 });
  Object.defineProperty(scroller, "scrollLeft", { value: 320 });
  fireEvent.scroll(scroller);
  fireEvent.click(screen.getByRole("button", { name: "Add or change reaction" }));
  fireEvent.click(screen.getByRole("button", { name: "React 👍" }));
  expect(write).toHaveBeenCalledExactlyOnceWith("second", "thumbsup");
});