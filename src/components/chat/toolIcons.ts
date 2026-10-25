import {
  BookOpen,
  Search,
  Globe,
  ClipboardCheck,
  Zap,
  Mail,
  Users,
  MessageSquare,
  CheckCircle,
} from "../icons";

export const toolIcons: Record<string, typeof Search> = {
  web_search: Globe,
  copy_to_clipboard: ClipboardCheck,
  get_snippet: Zap,
  update_snippets: Zap,
  update_dictionary: BookOpen,
  email_draft: Mail,
  find_contact: Users,
  github_search_issues: Search,
  github_create_issue: CheckCircle,
  github_comment: MessageSquare,
  slack_send_message: MessageSquare,
  linear_search_issues: Search,
  linear_create_issue: CheckCircle,
  linear_comment: MessageSquare,
};
