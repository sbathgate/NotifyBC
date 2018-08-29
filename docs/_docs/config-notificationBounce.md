---
layout: docs
title: Notification Bounce
permalink: /docs/config-notificationBounce/
---

Bounces, or Non-Delivery Reports (NDRs), are system-generated emails informing sender of failed delivery. *NotifyBC* can be configured to receive bounces, record bounces, and automatically unsubscribe all subscriptions of a recipient if the number of recorded hard bounces against the recipient exceeds threshold. A deemed successful notification delivery deletes the bounce record.

Although *NotifyBC* records all bounce emails, not all of them should count towards unsubscription threshold, but rather only the hard bounces - those which indicate permanent unrecoverable errors such as destination address no longer exists. In principle this can be distinguished using smtp response code.  In practice, however, there are some challenges to make the distinction 

* the smtp response code is not fully standarized and may vary by recepient's smtp server so it's unreliable
* there is no standard smtp header in bounce email to contain smtp response code. Often the response code is embedded in bounce email body.
* the bounce email template varies by sender's smtp server

To mitigate, *NotifyBC* defines several customizable string pattern filters in terms of regular expression. Only bounce emails matched the filters count towards unsubscription threshold. It's a matter of trial-and-error to get the correct filter suitable to your smtp server. 

<div class="note">
  <h5>ProTips™ to improve hard bounce recognition</h5>
  <p>Send non-existing emails to several external email systems. Inspect the bounce messages for common string patterns. After gone live, review bounce records in web console from time to time to identifty new bounce types and decide whether the bounce types qualify as hard bounce. To avoid false positives resulting in premature unsubscription, it is advisable to start with a high unsubscription threhold.</p>
</div>

Bounce handling involes four actions

* during notification dispatching, envelop address is set to a [VERP](https://en.wikipedia.org/wiki/Variable_envelope_return_path) in the form *bn-{subscriptionId}-{unsubscriptionCode}@{inboundSmtpServerDomain}* routed to *NotifyBC* [inbound smtp server](../config-inboundSmtpServer/). 
* when a notification finshed dispatching, the dispatching start and end time is recorded to all bounce records matching afftects recepient addresses
* when inbound smtp server receives a bounce message, it updates the bounce record by saving the message and incrementing the qualified bounce count when the message matches the filter criteria. The filter criteria are regular expressions matched against bounce email subject and body, as well as regular expression to extract recepient's email address from bounce email body. It also unsubscribes the user from all subscriptions when the qualified bounce count exceeds a predefined threshold.
* A cron job runs periodically to delete bounce records if the latest notification is deemed delivered successfully. 

To setup bounce handling

* set up [inbound smtp server](../config-inboundSmtpServer/)
* verify config *notification.handleBounce* is set to true or absent in */server/config.local.js*
* verify and adjust bounce threshold and bounce filter criteria if needed. 
  Following is the default config in file */server/config.json*

  ```
    "inboundSmtpServer": {
      ...
      "bounce": {
        "unsubThreshold": 5,
        "subjectRegex": "^Returned mail: see transcript for details",
        "smtpStatusCodeRegex": "5\\.\\d{1,3}\\.\\d{1,3}",
        "failedRecipientRegex": "(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|\"(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21\\x23-\\x5b\\x5d-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])*\")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21-\\x5a\\x53-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])+)\\])"
      }
    }
  ```
  where

  * *unsubThreshold* is the threshold count above which the user is unsubscribed from all subscriptions
  * *subjectRegex* is the regular expression that bounce message subject must match in order to count towards the threshold.
  * *smtpStatusCodeRegex* is the regular expression that smtp status code embeded in the message body must match in order to count towards the threshold. The default value matches all [rfc3463](https://tools.ietf.org/html/rfc3463) class 5 status codes. For a multi-part bounce message, the body limits to the part of Content-Type *message/delivery-status*, or in absence, plain text or html part.
  * *failedRecipientRegex* is the regular expression used to extract recipient's email address from bounce message body. This extracted recipient's email address is compared against the subscription record as a means of validation. If *failedRecipientRegex* is set to empty string or *undefined*, then this validation method is skipped. The default RegEx is taken from a [stackoverflow answer](https://stackoverflow.com/questions/201323/how-to-validate-an-email-address-using-a-regular-expression). For a multi-part bounce message, the body limits to the part of Content-Type *message/delivery-status*, or in absence, plain text or html part.
* Change config of cron job [Delete Notification Bounces](../config-cronJobs/#delete-notification-bounces) if needed