export interface EmailAttachment {
  /** Имя файла вложения (если есть) */
  filename: string | null;
  /** MIME-тип, например text/plain, application/msword */
  contentType: string | null;
  /** Размер в байтах */
  size: number;
  /** SHA-256 хэш содержимого (для проверки в VirusTotal) */
  hash?: string | null;
  /** Признак «опасного» типа: exe/scr/js/docm/xlsm/dmg/jar и т.п. */
  suspiciousType?: boolean;
  /** Человекочитаемая причина, если тип подозрительный */
  typeReason?: string;
}

export interface ParsedEmailMessage {
  /** Адрес отправителя (оригинальный From во вложенном .eml или в цитате) */
  fromAddress: string | null;
  /** Имя отправителя */
  fromName: string | null;
  /** Тема письма */
  subject: string | null;
  /** Целиком полученное сообщение как текст (уже собранное) */
  textBody: string;
  /** Список ссылок из тела письма */
  links: string[];

  attachments: EmailAttachment[];

  /** Сырое содержимое (raw source) вложенного .eml, если найден */
  originalRaw?: string | null;

  /** Куда пересылали (To оригинального письма) — может пригодиться */
  toAddress?: string | null;
  /** Дата письма */
  date?: Date | null;
}