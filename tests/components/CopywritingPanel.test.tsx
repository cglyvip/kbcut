import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CopywritingPanel from "../../src/renderer/src/components/CopywritingPanel/CopywritingPanel";
import {
  useCopywritingStore,
  emptyForm,
} from "../../src/renderer/src/stores/useCopywritingStore";

const llmState: { providers: any[] } = { providers: [] };

vi.mock("../../src/renderer/src/stores/useLlmStore", () => ({
  useLlmStore: (selector: any) => selector(llmState),
}));

vi.mock("../../src/renderer/src/stores/useAsrStore", () => ({
  useAsrStore: (selector: any) => selector({ segments: [] }),
}));

vi.mock("../../src/renderer/src/stores/useVideoStore", () => ({
  useVideoStore: (selector: any) => selector({ videoInfo: null }),
}));

function makeApi() {
  return {
    listCopywriting: vi.fn(async () => ({
      version: 1,
      updatedAt: 0,
      items: [],
    })),
    saveCopywriting: vi.fn(async (item: any) => ({
      ok: true,
      item: {
        ...item,
        id: item?.id || "copy-1",
        createdAt: 1000,
        updatedAt: 2000,
      },
    })),
    deleteCopywritingMany: vi.fn(async () => ({ ok: true, removed: 1 })),
    generateCopywriting: vi.fn(async () => ({
      title: "生成标题",
      content: "生成正文第一句\n生成正文第二句",
      usedProviderName: "主 API",
      usedModel: "gpt-4o-mini",
      inputTokens: 12,
      outputTokens: 34,
    })),
    exportCopywriting: vi.fn(async () => ({ ok: true, path: "D:/out/a.txt" })),
    writeClipboard: vi.fn(async () => ({ ok: true })),
    getCopywritingLibraryPath: vi.fn(
      async () => "C:/Users/Admin/AppData/Roaming/kbcut/copywriting/library.json",
    ),
  };
}

let api: ReturnType<typeof makeApi>;

function bodyTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/一行一句/) as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  llmState.providers = [];
  api = makeApi();
  (window as any).api = api;
  useCopywritingStore.setState({
    items: [],
    form: emptyForm(),
    dirty: false,
    loading: false,
    saving: false,
    generating: false,
    error: null,
    notice: null,
    hydrated: true,
  });
});

describe("CopywritingPanel", () => {
  it("shows the empty-library hint before anything is written", () => {
    render(<CopywritingPanel />);
    expect(screen.getByText(/还没有文案/)).toBeInTheDocument();
    expect(screen.getByText("文案库 · 0")).toBeInTheDocument();
  });

  it("saves a hand-written script and lists it in the library", async () => {
    render(<CopywritingPanel />);

    fireEvent.change(screen.getByPlaceholderText(/文案标题/), {
      target: { value: "厨房油污一喷就化" },
    });
    fireEvent.change(bodyTextarea(), {
      target: { value: "灶台油污擦半天？\n喷上去等 30 秒，一擦就干净。" },
    });

    fireEvent.click(screen.getByText("保存到文案库"));

    await waitFor(() => expect(api.saveCopywriting).toHaveBeenCalledTimes(1));
    expect(api.saveCopywriting.mock.calls[0]![0]).toMatchObject({
      title: "厨房油污一喷就化",
      content: "灶台油污擦半天？\n喷上去等 30 秒，一擦就干净。",
      status: "draft",
      source: "manual",
    });

    expect(
      await screen.findByText("厨房油污一喷就化"),
    ).toBeInTheDocument();
    expect(screen.getByText("文案库 · 1")).toBeInTheDocument();
  });

  it("refuses to save an empty script instead of writing a blank record", async () => {
    render(<CopywritingPanel />);

    fireEvent.click(screen.getByText("保存到文案库"));

    expect(
      await screen.findByText("标题和正文不能同时为空"),
    ).toBeInTheDocument();
    expect(api.saveCopywriting).not.toHaveBeenCalled();
  });

  it("copies the approved script to the clipboard", async () => {
    useCopywritingStore.setState({
      form: { ...emptyForm(), content: "复制我" },
    });
    render(<CopywritingPanel />);

    fireEvent.click(screen.getByText("复制正文"));

    await waitFor(() => expect(api.writeClipboard).toHaveBeenCalledWith("复制我"));
    expect(await screen.findByText("已复制")).toBeInTheDocument();
  });

  it("reports character count and estimated speech seconds", () => {
    useCopywritingStore.setState({
      form: { ...emptyForm(), content: "一二三四五六七八九" },
    });
    render(<CopywritingPanel />);

    expect(screen.getByText(/9 字 · 约 2\.0 秒口播/)).toBeInTheDocument();
  });

  it("fills the editor with the AI draft and remembers the provider", async () => {
    llmState.providers = [
      {
        id: "p1",
        name: "主 API",
        baseUrl: "https://example.com",
        apiKey: "sk-x",
        model: "gpt-4o-mini",
        enabled: true,
      },
    ];
    render(<CopywritingPanel />);

    fireEvent.click(screen.getByText("生成新文案"));

    await waitFor(() =>
      expect(api.generateCopywriting).toHaveBeenCalledTimes(1),
    );
    expect(api.generateCopywriting.mock.calls[0]![0]).toMatchObject({
      providers: llmState.providers,
      targetDurationSec: 45,
    });

    await waitFor(() =>
      expect(bodyTextarea().value).toBe("生成正文第一句\n生成正文第二句"),
    );
    expect(screen.getByText(/上次生成：主 API · gpt-4o-mini/)).toBeInTheDocument();
  });

  it("shows where the library file is stored", async () => {
    render(<CopywritingPanel />);
    expect(
      await screen.findByText(/copywriting[\\/]library\.json/),
    ).toBeInTheDocument();
  });

  it("deletes the selected script after confirmation", async () => {
    const item = {
      id: "copy-9",
      title: "要删掉的文案",
      content: "正文",
      status: "draft" as const,
      tags: [],
      brief: emptyForm().brief,
      source: "manual" as const,
      usedProviderName: "",
      usedModel: "",
      createdAt: 1,
      updatedAt: 2,
    };
    useCopywritingStore.setState({
      items: [item],
      form: { ...emptyForm(), id: "copy-9", title: "要删掉的文案", content: "正文" },
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<CopywritingPanel />);
    fireEvent.click(screen.getByText("删除"));

    await waitFor(() =>
      expect(api.deleteCopywritingMany).toHaveBeenCalledWith(["copy-9"]),
    );
    expect(screen.getByText("文案库 · 0")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});