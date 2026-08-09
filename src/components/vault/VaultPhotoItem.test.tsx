import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VaultPhotoItem } from "./VaultPhotoItem";

const signedUrlState = vi.hoisted(() => ({ signedUrl: "signed-photo.jpg", isLoading: false }));

vi.mock("@/hooks/useSignedPhotoUrl", () => ({
  useSignedPhotoUrl: () => signedUrlState,
}));

const photo = { id: "photo-1", title: "Match day", file_url: "private-photo.jpg" };

const renderLoaded = (props: Partial<React.ComponentProps<typeof VaultPhotoItem>> = {}) => {
  const callbacks = {
    onPhotoClick: vi.fn(),
    onDelete: vi.fn(),
    onDownload: vi.fn(),
    onRename: vi.fn(),
    onToggleSelection: vi.fn(),
  };
  const { container } = render(<VaultPhotoItem
    photo={photo}
    index={2}
    canDelete
    canRename
    {...callbacks}
    {...props}
  />);
  const preload = container.querySelector('img[alt=""]');
  expect(preload).not.toBeNull();
  fireEvent.load(preload);
  return { ...callbacks, container };
};

describe("VaultPhotoItem", () => {
  beforeEach(() => {
    signedUrlState.signedUrl = "signed-photo.jpg";
    signedUrlState.isLoading = false;
  });

  it("renders an explicit empty state when neither photo URL exists", () => {
    render(<VaultPhotoItem
      photo={{ id: "photo-1" }}
      index={0}
      canDelete={false}
      onPhotoClick={vi.fn()}
      onDelete={vi.fn()}
    />);
    expect(screen.getByText("No image")).toBeInTheDocument();
  });

  it("waits for the signed URL and image preload before revealing content", () => {
    signedUrlState.isLoading = true;
    const { container, rerender } = render(<VaultPhotoItem
      photo={photo}
      index={0}
      canDelete={false}
      onPhotoClick={vi.fn()}
      onDelete={vi.fn()}
    />);
    expect(screen.getByTestId("vault-photo-skeleton")).toBeInTheDocument();
    expect(screen.queryByAltText("Match day")).not.toBeInTheDocument();
    signedUrlState.isLoading = false;
    rerender(<VaultPhotoItem
      photo={photo}
      index={0}
      canDelete={false}
      onPhotoClick={vi.fn()}
      onDelete={vi.fn()}
    />);
    const preload = container.querySelector('img[alt=""]');
    expect(preload).not.toBeNull();
    fireEvent.load(preload);
    expect(screen.getByAltText("Match day")).toHaveAttribute("src", "signed-photo.jpg");
  });

  it("shows a stable failure state after preload error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = render(<VaultPhotoItem
      photo={photo}
      index={0}
      canDelete={false}
      onPhotoClick={vi.fn()}
      onDelete={vi.fn()}
    />);
    const preload = container.querySelector('img[alt=""]');
    expect(preload).not.toBeNull();
    fireEvent.error(preload);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("opens the photo by its supplied index outside selection mode", () => {
    const callbacks = renderLoaded();
    fireEvent.click(screen.getByAltText("Match day"));
    expect(callbacks.onPhotoClick).toHaveBeenCalledWith(2);
    expect(callbacks.onToggleSelection).not.toHaveBeenCalled();
  });

  it("toggles only selection in selection mode", () => {
    const callbacks = renderLoaded({ selectionMode: true, isSelected: true });
    fireEvent.click(screen.getByAltText("Match day"));
    const selectionOverlay = callbacks.container.querySelector(".absolute.top-1\\.5.left-1\\.5");
    expect(selectionOverlay).not.toBeNull();
    fireEvent.click(selectionOverlay);
    expect(callbacks.onToggleSelection).toHaveBeenCalledTimes(2);
    expect(callbacks.onToggleSelection).toHaveBeenNthCalledWith(1, "photo-1");
    expect(callbacks.onPhotoClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Photo actions" })).not.toBeInTheDocument();
  });

  it("delegates only authorized download, rename and delete actions", () => {
    const callbacks = renderLoaded();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Photo actions" }), { button: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));
    expect(callbacks.onDownload).toHaveBeenCalledWith("signed-photo.jpg", "Match day");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Photo actions" }), { button: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(callbacks.onRename).toHaveBeenCalledWith(photo);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Photo actions" }), { button: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(callbacks.onDelete).toHaveBeenCalledWith("photo-1");
  });
});
