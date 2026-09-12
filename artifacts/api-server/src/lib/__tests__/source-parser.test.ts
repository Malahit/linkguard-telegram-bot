import { describe, it, expect } from "vitest";
import { normalizeSlug, parseChannelHtml, decodeEntities } from "../source-parser";
import { contentHash } from "../content-utils";

const FIXTURE = `
<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message js-widget_message" data-post="cyberyozh_official/100">
    <div class="tgme_widget_message_bubble">
      <div class="tgme_widget_message_text js-message_text" dir="auto">
        Привет &amp; добро пожаловать<br>Вторая строка с <a href="https://example.com">ссылкой</a>
      </div>
      <div class="tgme_widget_message_footer">
        <a class="tgme_widget_message_date" href="https://t.me/cyberyozh_official/100">
          <time datetime="2026-09-12T10:00:55+00:00">10:00</time>
        </a>
      </div>
    </div>
  </div>
</div>
<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message js-widget_message" data-post="cyberyozh_official/101">
    <div class="tgme_widget_message_bubble">
      <div class="tgme_widget_message_footer">
        <a class="tgme_widget_message_date" href="https://t.me/cyberyozh_official/101">
          <time datetime="2026-09-12T11:00:00+00:00">11:00</time>
        </a>
      </div>
    </div>
  </div>
</div>
`;

describe("source-parser: normalizeSlug", () => {
  it("приводит разные формы к slug", () => {
    expect(normalizeSlug("@cyberpolice_rus")).toBe("cyberpolice_rus");
    expect(normalizeSlug("https://t.me/cyberpolice_rus")).toBe("cyberpolice_rus");
    expect(normalizeSlug("https://t.me/s/Social_engineering")).toBe(
      "Social_engineering",
    );
    expect(normalizeSlug("t.me/s/cyberyozh_official")).toBe("cyberyozh_official");
    expect(normalizeSlug("  @pro_infosec  ")).toBe("pro_infosec");
  });
});

describe("source-parser: parseChannelHtml", () => {
  it("извлекает посты, декодирует сущности и пропускает блоки без текста", () => {
    const posts = parseChannelHtml(FIXTURE, "cyberyozh_official");
    expect(posts).toHaveLength(1);

    const post = posts[0]!;
    expect(post.externalId).toBe("cyberyozh_official/100");
    expect(post.text).toContain("Привет & добро пожаловать");
    expect(post.text).toContain("Вторая строка с ссылкой");
    expect(post.text).not.toContain("<a");
    expect(post.sourceUrl).toBe("https://t.me/cyberyozh_official/100");
    expect(post.postedAt?.toISOString()).toBe("2026-09-12T10:00:55.000Z");
  });

  it("не дублирует посты с одинаковым external_id", () => {
    const posts = parseChannelHtml(FIXTURE + FIXTURE, "cyberyozh_official");
    const ids = posts.map((p) => p.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("source-parser: decodeEntities", () => {
  it("декодирует именованные и числовые сущности", () => {
    expect(decodeEntities("a &amp; b &lt; c &#1055;&#x440;")).toBe("a & b < c Пр");
  });
});

describe("content-utils: contentHash", () => {
  it("стабилен к пробелам и регистру, различает разный текст", () => {
    expect(contentHash("Hello   World")).toBe(contentHash("hello world"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
    expect(contentHash("text")).toHaveLength(40);
  });
});
