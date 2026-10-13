import type { Messages } from "./en";
import { plural } from "./plural";

const minutes = (n: number) =>
  plural("ru", n, { one: "# минуту", few: "# минуты", many: "# минут", other: "# минуты" });

export const ru: Messages = {
  languageName: "Русский",
  common: {
    loading: "Загрузка…",
    retry: "Повторить",
    unreachable: "Сервер недоступен. Проверьте подключение и попробуйте ещё раз.",
    optional: "необязательно",
    language: "Язык",
  },
  auth: {
    username: "Имя пользователя",
    password: "Пароль",
    signIn: {
      title: "Вход",
      submit: "Войти",
      submitting: "Входим…",
    },
    setup: {
      title: "Добро пожаловать в Thule",
      lead: "На сервере ещё нет аккаунтов. Создайте аккаунт администратора, чтобы начать.",
      displayName: "Ваше имя",
      confirmPassword: "Повторите пароль",
      submit: "Создать аккаунт",
      submitting: "Создаём аккаунт…",
      alreadyDone: "Сервер уже настроен. Войдите в свой аккаунт.",
    },
    validation: {
      required: "Заполните это поле",
      usernameLength: "От 2 до 64 символов",
      usernameChars: "Только латинские буквы, цифры, точка, дефис и подчёркивание",
      passwordLength: (min: number) =>
        `Не короче ${plural("ru", min, { one: "# символа", few: "# символов", many: "# символов", other: "# символа" })}`,
      passwordsDiffer: "Пароли не совпадают",
    },
    tryAgainIn: (seconds: number) =>
      `Слишком много неудачных попыток. Попробуйте снова через ${minutes(Math.max(1, Math.ceil(seconds / 60)))}.`,
    ended: {
      "signed-out": "Вы вышли из аккаунта.",
      expired: "Сессия истекла. Войдите снова.",
      revoked: "В целях безопасности вы вышли на всех устройствах. Войдите снова.",
    },
    signOut: "Выйти",
    signingOut: "Выходим…",
    signedInAs: "Вы вошли как",
    admin: "Администратор",
  },
  home: {
    comingSoon: "Библиотека, плеер и настройки появятся на следующих этапах.",
  },
  errors: {
    bad_request: "Некорректный запрос.",
    forbidden: "Нет доступа.",
    not_found: "Не найдено.",
    method_not_allowed: "Это действие не поддерживается.",
    validation_error: "Проверьте введённые данные.",
    http_error: "На сервере что-то пошло не так.",
    not_authenticated: "Войдите, чтобы продолжить.",
    invalid_token: "Сессия истекла. Войдите снова.",
    admin_only: "Это может сделать только администратор.",
    registration_closed: "Создавать аккаунты может только администратор.",
    username_taken: "Это имя пользователя уже занято.",
    invalid_credentials: "Неверное имя пользователя или пароль.",
    too_many_login_attempts: "Слишком много неудачных попыток. Попробуйте позже.",
    invalid_refresh_token: "Сессия завершена. Войдите снова.",
    refresh_token_rotated: "Сессия обновилась в другой вкладке. Попробуйте ещё раз.",
    refresh_token_reused: "В целях безопасности вы вышли на всех устройствах. Войдите снова.",
    refresh_token_expired: "Сессия истекла. Войдите снова.",
    user_not_found: "Пользователь не найден.",
    cannot_delete_self: "Нельзя удалить собственный аккаунт.",
    cannot_change_own_role: "Нельзя изменить собственную роль.",
    wrong_password: "Текущий пароль указан неверно.",
    not_an_image: "Этот файл — не поддерживаемое изображение.",
    image_too_large: "Изображение слишком большое.",
    artist_not_found: "Исполнитель не найден.",
    album_not_found: "Альбом не найден.",
    track_not_found: "Трек не найден.",
    not_an_audio_file: "Этот файл — не поддерживаемый аудиоформат.",
    invalid_stream_signature: "Ссылка на воспроизведение устарела.",
    audio_file_missing: "Аудиофайл пропал с сервера.",
    cover_not_found: "Обложка не найдена.",
    cover_file_missing: "Файл обложки пропал с сервера.",
    invalid_cover_size: "Неподдерживаемый размер обложки.",
    lyrics_not_found: "Для этого трека нет текста.",
    playlist_not_found: "Плейлист не найден.",
    playlist_item_not_found: "Этого трека уже нет в плейлисте.",
    unknown_tracks: "Некоторых треков больше нет.",
  },
};
