import Send from "lucide-solid/icons/send";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/** Transcribed from `formSubmit()` in `packages/web-tag/src/core.ts`. */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "form_submit",
    slug: "event-form-submit",
    summary: "A form was submitted. The identity of the form, and nothing that was in it.",
    order: 60,
    icon: Send,
    written: "Browser tag.",
    severity: "9 (INFO)",
    off: 'data-auto-forms="false"',
    when: () => (
      <>
        <p>
          On a submit event reaching the document, in the capture phase. Every form on the page
          counts, including one a framework handles entirely in JavaScript, because the browser
          fires the event either way.
        </p>
        <p>
          Capture phase means we see the submit <strong>before</strong> the page's own handler has
          had a chance to cancel it. A form that fails validation therefore looks the same as one
          that went through, and that is a limit of the automatic measurement rather than a
          setting.
        </p>
      </>
    ),
    attrs: [
      {
        key: "firstrun.form.id",
        type: "string",
        what: "The form's id attribute. Absent when it has none.",
      },
      {
        key: "firstrun.form.name",
        type: "string",
        what: "The form's name attribute. Absent when it has none.",
      },
    ],
    never: () => (
      <>
        <p>
          No field, no value, no label, and not even a count of fields. The two attributes above
          are read off the form element itself, and there is no setting that makes anything else be
          read.
        </p>
        <p>
          It does not say whether the submission succeeded. For that, write your own event once the
          request comes back: a signup having been created is a different question from a form
          having been submitted, and it is one only your code can answer.
        </p>
      </>
    ),
    questions: [
      {
        question: "Which forms get used",
        how: "Name is form_submit . group by firstrun.form.id . count of entries",
      },
      {
        question: "Submissions over time",
        how: "Name is form_submit . count of entries . bucket by day",
      },
      { question: "How many people submit anything", how: "Name is form_submit . count of uniques" },
    ],
    related: [
      { topic: "event-page-view", label: "page_view" },
      { topic: "event-log", label: "log" },
    ],
  }),
];
