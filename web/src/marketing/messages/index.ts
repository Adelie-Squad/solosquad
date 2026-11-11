// Importing this loads the marketing site's words next to the app's (the landing and the
// marketing pages import it; the customer build never does — C62).
import { addMessages } from '../../i18n';
import { en } from './en';
import { ko } from './ko';
import { zhCN } from './zh-CN';

export const marketingMessages = { ko, en, 'zh-CN': zhCN } as const;

addMessages(marketingMessages);
