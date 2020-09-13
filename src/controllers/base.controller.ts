import {inject} from '@loopback/context';
import {ApplicationConfig, CoreBindings} from '@loopback/core';
import axios from 'axios';
import _ from 'lodash';

const toSentence = require('underscore.string/toSentence');
const pluralize = require('pluralize');

const ipRangeCheck = require('ip-range-check');
interface SMSBody {
  MessageBody: string;
  [key: string]: string;
}

export class BaseController {
  constructor(
    @inject(CoreBindings.APPLICATION_CONFIG)
    private appConfig: ApplicationConfig,
  ) {}

  isAdminReq(
    httpCtx: any,
    ignoreAccessToken?: boolean,
    ignoreSurrogate?: boolean,
  ): boolean {
    // internal requests
    if (!httpCtx || !httpCtx.req) {
      return true;
    }
    if (!ignoreSurrogate) {
      if (
        httpCtx.req.get('SM_UNIVERSALID') ||
        httpCtx.req.get('sm_user') ||
        httpCtx.req.get('smgov_userdisplayname') ||
        httpCtx.req.get('is_anonymous')
      ) {
        return false;
      }
    }
    if (!ignoreAccessToken) {
      try {
        const token = httpCtx.args.options && httpCtx.args.options.accessToken;
        if (token && token.userId) {
          return true;
        }
      } catch (ex) {}
    }

    const adminIps = this.appConfig.adminIps || this.appConfig.defaultAdminIps;
    if (adminIps) {
      return adminIps.some(function (e: string) {
        return ipRangeCheck(httpCtx.req.ip, e);
      });
    }
    return false;
  }

  getCurrentUser(httpCtx: any) {
    // internal requests
    if (!httpCtx) return null;

    var currUser =
      httpCtx.req.get('SM_UNIVERSALID') ||
      httpCtx.req.get('sm_user') ||
      httpCtx.req.get('smgov_userdisplayname');
    if (!currUser) {
      return null;
    }
    if (this.isAdminReq(httpCtx, undefined, true)) {
      return currUser;
    }
    var siteMinderReverseProxyIps =
      this.appConfig.siteMinderReverseProxyIps ||
      this.appConfig.defaultSiteMinderReverseProxyIps;
    if (!siteMinderReverseProxyIps || siteMinderReverseProxyIps.length <= 0) {
      return null;
    }
    // rely on express 'trust proxy' settings to obtain real ip
    var realIp = httpCtx.req.ip;
    var isFromSM = siteMinderReverseProxyIps.some(function (e: string) {
      return ipRangeCheck(realIp, e);
    });
    return isFromSM ? currUser : null;
  }

  smsClient: any;
  async sendSMS(to: string, textBody: string, data: any, cb: Function) {
    let smsServiceProvider = this.appConfig.smsServiceProvider;
    let smsConfig = this.appConfig.sms[smsServiceProvider];
    switch (smsServiceProvider) {
      case 'swift':
        try {
          let url = `${smsConfig['apiUrlPrefix']}${
            smsConfig['accountKey']
          }/${encodeURIComponent(to)}`;
          let body: SMSBody = {
            MessageBody: textBody,
          };
          if (data && data.id) {
            body.Reference = data.id;
          }
          await axios.post(url, body, {
            headers: {
              'Content-Type': 'application/json;charset=UTF-8',
            },
          });
        } catch (ex) {
          return cb && cb(ex);
        }
        cb && cb();
        break;
      default:
        // Twilio Credentials
        var accountSid = smsConfig.accountSid;
        var authToken = smsConfig.authToken;
        //require the Twilio module and create a REST client
        this.smsClient =
          this.smsClient || require('twilio')(accountSid, authToken);

        this.smsClient.messages.create(
          {
            to: to,
            from: smsConfig.fromNumber,
            body: textBody,
          },
          function (err: any, message: any) {
            cb && cb(err, message);
          },
        );
    }
  }

  nodemailer = require('nodemailer');
  directTransport = require('nodemailer-direct-transport');
  transporter: any;
  sendEmail(mailOptions: any, cb: Function) {
    return new Promise((resolve, reject) => {
      if (!this.transporter) {
        let smtpCfg = this.appConfig.smtp || this.appConfig.defaultSmtp;
        if (smtpCfg.direct) {
          this.transporter = this.nodemailer.createTransport(
            this.directTransport(smtpCfg),
          );
        } else {
          this.transporter = this.nodemailer.createTransport(smtpCfg);
        }
      }
      this.transporter.sendMail(mailOptions, function (error: any, info: any) {
        try {
          if (!error && info.accepted.length < 1) {
            error = new Error('delivery failed');
          }
        } catch (ex) {}
        if (cb) {
          return cb(error, info);
        } else {
          if (error) {
            return reject(error);
          } else {
            return resolve(info);
          }
        }
      });
    });
  }

  mailMerge(srcTxt: any, data: any, httpCtx: any) {
    let output = srcTxt;
    try {
      output = output.replace(
        /\{subscription_confirmation_code\}/gi,
        data.confirmationRequest.confirmationCode,
      );
    } catch (ex) {}
    try {
      output = output.replace(/\{service_name\}/gi, data.serviceName);
    } catch (ex) {}
    try {
      if (output.match(/\{unsubscription_service_names\}/i)) {
        let serviceNames = _.union(
          [data.serviceName],
          data.unsubscribedAdditionalServices
            ? data.unsubscribedAdditionalServices.names
            : [],
        );
        output = output.replace(
          /\{unsubscription_service_names\}/gi,
          pluralize('service', serviceNames.length) +
            ' ' +
            toSentence(serviceNames),
        );
      }
    } catch (ex) {}
    let httpHost;
    try {
      if (httpCtx.req) {
        httpHost = httpCtx.req.protocol + '://' + httpCtx.req.get('host');
      }
      if (this.appConfig.httpHost) {
        httpHost = this.appConfig.httpHost;
      }
      if (httpCtx.args && httpCtx.args.data && httpCtx.args.data.httpHost) {
        httpHost = httpCtx.args.data.httpHost;
      } else if (httpCtx.instance && httpCtx.instance.httpHost) {
        httpHost = httpCtx.instance.httpHost;
      }
      output = output.replace(/\{http_host\}/gi, httpHost);
    } catch (ex) {}
    try {
      output = output.replace(
        /\{rest_api_root\}/gi,
        this.appConfig.restApiRoot,
      );
    } catch (ex) {}
    try {
      output = output.replace(/\{subscription_id\}/gi, data.id);
    } catch (ex) {}
    try {
      output = output.replace(
        /\{unsubscription_code\}/gi,
        data.unsubscriptionCode,
      );
    } catch (ex) {}
    try {
      output = output.replace(
        /\{unsubscription_url\}/gi,
        httpHost +
          this.appConfig.restApiRoot +
          '/subscriptions/' +
          data.id +
          '/unsubscribe?unsubscriptionCode=' +
          data.unsubscriptionCode,
      );
    } catch (ex) {}
    try {
      output = output.replace(
        /\{unsubscription_all_url\}/gi,
        httpHost +
          this.appConfig.restApiRoot +
          '/subscriptions/' +
          data.id +
          '/unsubscribe?unsubscriptionCode=' +
          data.unsubscriptionCode +
          '&additionalServices=_all',
      );
    } catch (ex) {}
    try {
      output = output.replace(
        /\{subscription_confirmation_url\}/gi,
        httpHost +
          this.appConfig.restApiRoot +
          '/subscriptions/' +
          data.id +
          '/verify?confirmationCode=' +
          data.confirmationRequest.confirmationCode,
      );
    } catch (ex) {}
    try {
      output = output.replace(
        /\{unsubscription_reversion_url\}/gi,
        httpHost +
          this.appConfig.restApiRoot +
          '/subscriptions/' +
          data.id +
          '/unsubscribe/undo?unsubscriptionCode=' +
          data.unsubscriptionCode,
      );
    } catch (ex) {}

    // for backward compatibilities
    try {
      output = output.replace(
        /\{confirmation_code\}/gi,
        data.confirmationRequest.confirmationCode,
      );
    } catch (ex) {}
    try {
      output = output.replace(/\{serviceName\}/gi, data.serviceName);
    } catch (ex) {}
    try {
      output = output.replace(/\{restApiRoot\}/gi, this.appConfig.restApiRoot);
    } catch (ex) {}
    try {
      output = output.replace(/\{subscriptionId\}/gi, data.id);
    } catch (ex) {}
    try {
      output = output.replace(
        /\{unsubscriptionCode\}/gi,
        data.unsubscriptionCode,
      );
    } catch (ex) {}
    try {
      if (data.data) {
        // substitute all other tokens with matching data.data properties
        let matches = output.match(/{.+?}/g);
        if (matches) {
          matches.forEach(function (e: string) {
            try {
              let token = (e.match(/{(.+)}/) || [])[1];
              let val = _.get(data.data, token);
              if (val) {
                output = output.replace(e, val);
              }
            } catch (ex) {}
          });
        }
      }
    } catch (ex) {}
    return output;
  }
}
