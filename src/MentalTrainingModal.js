import React, { useEffect, useRef, useState } from 'react';
import { X, Brain, ExternalLink, Copy, Check } from 'lucide-react';
import { useModalTracking } from './usage';

/* ------------------------------------------------------------------ *
 *  EDIT ME — everything a non-developer might need to change is here.
 *  These came from Brandon Guyer's email of 27 Aug 2026.
 * ------------------------------------------------------------------ */
const MLM_UNLOCKED_URL   = 'https://www.brandonguyer.com/unlocked';
const MLM_5WEEK_URL      = 'https://www.brandonguyer.com/5weekrecordings';
// #375 FIX (2 Sep 2026). The checkout link used to point at
// /5weektrainingcheckout, which sells the 5-Week Fast Track ALONE for $747 —
// while this pop-up promised $497 for everything. A parent clicking through
// landed on the wrong programme at the wrong price.
//
// Brandon Guyer's own words, relayed by Cordell on the issue:
//   "You can have them use this link https://www.brandonguyer.com/unlocked.
//    This will sign them up for the unlocked program for $497. We will then
//    have them use discount code NPBLIFETIME at checkout to save $100 and
//    bring the price down to $397."
// Cordell then confirmed: "The user will just have to manually input
// NBPLIFETIME when they get to the page."
//
// 🔴 UNRESOLVED — CHECK BEFORE TELLING ANY FAMILY ABOUT THIS BUTTON:
// Brandon typed the code as "NPBLIFETIME" (N-P-B). Cordell wrote it twice as
// "NBPLIFETIME" (N-B-P), which is also what was already in this file and reads
// like "NBP LIFETIME". One of the two is a typo. If the code shown here is not
// the code configured on Brandon's checkout, the family is charged $100 more
// than we told them. Confirm the exact spelling with Brandon, then set it below.
const MLM_CHECKOUT_URL   = 'https://www.brandonguyer.com/unlocked';
const MLM_DISCOUNT_CODE  = 'NBPLIFETIME';
const MLM_PRICE          = '$497';   // Unlocked list price on Brandon's page
const MLM_CODE_SAVING    = '$100';   // what NBPLIFETIME takes off
const MLM_PRICE_NET      = '$397';   // what the player actually pays
const MLM_5WEEK_LIST     = '$747';
/* ------------------------------------------------------------------ */

// Note for whoever picks this up next: the portal cannot itself verify or record
// the revenue share on these sales. There is no callback from the partner's
// checkout into this app. Attribution is tracked entirely on Brandon Guyer's
// side, by the discount code above being used at checkout — so the code must
// keep matching whatever is configured there.

export default function MentalTrainingModal({ onClose }) {
  useModalTracking('MentalTrainingModal');
  const [copied, setCopied] = useState(false);
  const codeRef = useRef(null);

  // Read-only content, nothing typed: safe to close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyCode = async () => {
    // Clipboard access fails in plenty of ordinary situations (no HTTPS, an
    // older browser, permission denied). Never let that throw — fall back to
    // selecting the code so the user can copy it by hand.
    try {
      await navigator.clipboard.writeText(MLM_DISCOUNT_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      try {
        const node = codeRef.current;
        if (node && window.getSelection) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (selErr) {
        // Nothing more we can do; the code is on screen and readable either way.
      }
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200">
          <div className="flex items-start space-x-3 min-w-0">
            <Brain className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 line-clamp-2 break-words">
                Mental Training — Major League Mindset
              </h3>
              <p className="text-xs text-gray-500 line-clamp-2 break-words mt-0.5">
                In partnership with Brandon Guyer, Founder / Head Coach, Major League Mindset.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4 space-y-4">
          <p className="text-sm text-gray-700">
            NBP players get the <span className="font-semibold">Unlocked Self-Paced Training
            Program</span> for <span className="font-semibold">{MLM_PRICE_NET}</span> — that is
            the {MLM_PRICE} price on Brandon Guyer's site, less {MLM_CODE_SAVING} with the NBP
            code below.
          </p>

          <ul className="space-y-2 text-sm text-gray-700">
            <li className="border border-gray-200 rounded-lg px-3 py-2">
              <span className="font-medium text-gray-900">Unlocked Self-Paced Training Program</span>
              <span className="text-gray-500"> — {MLM_PRICE}, or {MLM_PRICE_NET} with your code</span>
            </li>
            <li className="border border-gray-200 rounded-lg px-3 py-2">
              <span className="font-medium text-gray-900">MLM+ app</span>
              <span className="text-gray-500"> — included with the program</span>
            </li>
          </ul>

          <p className="text-xs text-gray-500">
            The 5-Week Fast Track LIVE program ({MLM_5WEEK_LIST}) is a separate purchase on
            Brandon's site and is not included in this offer.
          </p>

          {/* Discount code */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-3">
            <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide mb-2">
              Your discount code
            </p>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <code
                ref={codeRef}
                className="font-mono text-sm font-semibold text-gray-900 bg-white border border-blue-200 rounded px-3 py-1.5 break-all"
              >
                {MLM_DISCOUNT_CODE}
              </code>
              <button
                type="button"
                onClick={copyCode}
                className="flex items-center space-x-1 text-xs font-medium text-blue-700 hover:text-blue-900 border border-blue-300 rounded px-2.5 py-1.5 bg-white transition"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copied' : 'Copy code'}</span>
              </button>
            </div>
          </div>

          <p className="text-sm text-gray-600">
            Type {MLM_DISCOUNT_CODE} into the discount box at checkout — it is not applied
            automatically. That takes {MLM_CODE_SAVING} off, bringing the price to{' '}
            <span className="font-semibold">{MLM_PRICE_NET}</span>.
          </p>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1">
            <a
              href={MLM_5WEEK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center space-x-1"
            >
              <span>5-Week Fast Track</span>
              <ExternalLink size={12} />
            </a>
            <a
              href={MLM_UNLOCKED_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center space-x-1"
            >
              <span>Unlocked Self-Paced</span>
              <ExternalLink size={12} />
            </a>
          </div>
        </div>

        {/* Footer — a sibling of the scrolling body, so the actions can never
            end up below the fold (see the modal QA notes on this project). */}
        <div className="flex-shrink-0 flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition text-sm"
          >
            Close
          </button>
          <a
            href={MLM_CHECKOUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition text-sm inline-flex items-center space-x-1.5"
          >
            <span>Go to checkout</span>
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
