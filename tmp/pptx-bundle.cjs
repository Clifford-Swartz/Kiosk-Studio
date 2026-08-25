"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/util.js
var require_util = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/util.js"(exports2) {
    "use strict";
    var nameStartChar = ":A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD";
    var nameChar = nameStartChar + "\\-.\\d\\u00B7\\u0300-\\u036F\\u203F-\\u2040";
    var nameRegexp = "[" + nameStartChar + "][" + nameChar + "]*";
    var regexName = new RegExp("^" + nameRegexp + "$");
    var getAllMatches = function(string, regex) {
      const matches = [];
      let match = regex.exec(string);
      while (match) {
        const allmatches = [];
        allmatches.startIndex = regex.lastIndex - match[0].length;
        const len = match.length;
        for (let index = 0; index < len; index++) {
          allmatches.push(match[index]);
        }
        matches.push(allmatches);
        match = regex.exec(string);
      }
      return matches;
    };
    var isName = function(string) {
      const match = regexName.exec(string);
      return !(match === null || typeof match === "undefined");
    };
    exports2.isExist = function(v) {
      return typeof v !== "undefined";
    };
    exports2.isEmptyObject = function(obj) {
      return Object.keys(obj).length === 0;
    };
    exports2.merge = function(target, a, arrayMode) {
      if (a) {
        const keys = Object.keys(a);
        const len = keys.length;
        for (let i = 0; i < len; i++) {
          if (arrayMode === "strict") {
            target[keys[i]] = [a[keys[i]]];
          } else {
            target[keys[i]] = a[keys[i]];
          }
        }
      }
    };
    exports2.getValue = function(v) {
      if (exports2.isExist(v)) {
        return v;
      } else {
        return "";
      }
    };
    var DANGEROUS_PROPERTY_NAMES = [
      // '__proto__',
      // 'constructor',
      // 'prototype',
      "hasOwnProperty",
      "toString",
      "valueOf",
      "__defineGetter__",
      "__defineSetter__",
      "__lookupGetter__",
      "__lookupSetter__"
    ];
    var criticalProperties = ["__proto__", "constructor", "prototype"];
    exports2.isName = isName;
    exports2.getAllMatches = getAllMatches;
    exports2.nameRegexp = nameRegexp;
    exports2.DANGEROUS_PROPERTY_NAMES = DANGEROUS_PROPERTY_NAMES;
    exports2.criticalProperties = criticalProperties;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/validator.js
var require_validator = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/validator.js"(exports2) {
    "use strict";
    var util = require_util();
    var defaultOptions = {
      allowBooleanAttributes: false,
      //A tag can have attributes without any value
      unpairedTags: []
    };
    exports2.validate = function(xmlData, options) {
      options = Object.assign({}, defaultOptions, options);
      const tags = [];
      let tagFound = false;
      let reachedRoot = false;
      if (xmlData[0] === "\uFEFF") {
        xmlData = xmlData.substr(1);
      }
      for (let i = 0; i < xmlData.length; i++) {
        if (xmlData[i] === "<" && xmlData[i + 1] === "?") {
          i += 2;
          i = readPI(xmlData, i);
          if (i.err) return i;
        } else if (xmlData[i] === "<") {
          let tagStartPos = i;
          i++;
          if (xmlData[i] === "!") {
            i = readCommentAndCDATA(xmlData, i);
            continue;
          } else {
            let closingTag = false;
            if (xmlData[i] === "/") {
              closingTag = true;
              i++;
            }
            let tagName = "";
            for (; i < xmlData.length && xmlData[i] !== ">" && xmlData[i] !== " " && xmlData[i] !== "	" && xmlData[i] !== "\n" && xmlData[i] !== "\r"; i++) {
              tagName += xmlData[i];
            }
            tagName = tagName.trim();
            if (tagName[tagName.length - 1] === "/") {
              tagName = tagName.substring(0, tagName.length - 1);
              i--;
            }
            if (!validateTagName(tagName)) {
              let msg;
              if (tagName.trim().length === 0) {
                msg = "Invalid space after '<'.";
              } else {
                msg = "Tag '" + tagName + "' is an invalid name.";
              }
              return getErrorObject("InvalidTag", msg, getLineNumberForPosition(xmlData, i));
            }
            const result = readAttributeStr(xmlData, i);
            if (result === false) {
              return getErrorObject("InvalidAttr", "Attributes for '" + tagName + "' have open quote.", getLineNumberForPosition(xmlData, i));
            }
            let attrStr = result.value;
            i = result.index;
            if (attrStr[attrStr.length - 1] === "/") {
              const attrStrStart = i - attrStr.length;
              attrStr = attrStr.substring(0, attrStr.length - 1);
              const isValid = validateAttributeString(attrStr, options);
              if (isValid === true) {
                tagFound = true;
              } else {
                return getErrorObject(isValid.err.code, isValid.err.msg, getLineNumberForPosition(xmlData, attrStrStart + isValid.err.line));
              }
            } else if (closingTag) {
              if (!result.tagClosed) {
                return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' doesn't have proper closing.", getLineNumberForPosition(xmlData, i));
              } else if (attrStr.trim().length > 0) {
                return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' can't have attributes or invalid starting.", getLineNumberForPosition(xmlData, tagStartPos));
              } else if (tags.length === 0) {
                return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' has not been opened.", getLineNumberForPosition(xmlData, tagStartPos));
              } else {
                const otg = tags.pop();
                if (tagName !== otg.tagName) {
                  let openPos = getLineNumberForPosition(xmlData, otg.tagStartPos);
                  return getErrorObject(
                    "InvalidTag",
                    "Expected closing tag '" + otg.tagName + "' (opened in line " + openPos.line + ", col " + openPos.col + ") instead of closing tag '" + tagName + "'.",
                    getLineNumberForPosition(xmlData, tagStartPos)
                  );
                }
                if (tags.length == 0) {
                  reachedRoot = true;
                }
              }
            } else {
              const isValid = validateAttributeString(attrStr, options);
              if (isValid !== true) {
                return getErrorObject(isValid.err.code, isValid.err.msg, getLineNumberForPosition(xmlData, i - attrStr.length + isValid.err.line));
              }
              if (reachedRoot === true) {
                return getErrorObject("InvalidXml", "Multiple possible root nodes found.", getLineNumberForPosition(xmlData, i));
              } else if (options.unpairedTags.indexOf(tagName) !== -1) {
              } else {
                tags.push({ tagName, tagStartPos });
              }
              tagFound = true;
            }
            for (i++; i < xmlData.length; i++) {
              if (xmlData[i] === "<") {
                if (xmlData[i + 1] === "!") {
                  i++;
                  i = readCommentAndCDATA(xmlData, i);
                  continue;
                } else if (xmlData[i + 1] === "?") {
                  i = readPI(xmlData, ++i);
                  if (i.err) return i;
                } else {
                  break;
                }
              } else if (xmlData[i] === "&") {
                const afterAmp = validateAmpersand(xmlData, i);
                if (afterAmp == -1)
                  return getErrorObject("InvalidChar", "char '&' is not expected.", getLineNumberForPosition(xmlData, i));
                i = afterAmp;
              } else {
                if (reachedRoot === true && !isWhiteSpace(xmlData[i])) {
                  return getErrorObject("InvalidXml", "Extra text at the end", getLineNumberForPosition(xmlData, i));
                }
              }
            }
            if (xmlData[i] === "<") {
              i--;
            }
          }
        } else {
          if (isWhiteSpace(xmlData[i])) {
            continue;
          }
          return getErrorObject("InvalidChar", "char '" + xmlData[i] + "' is not expected.", getLineNumberForPosition(xmlData, i));
        }
      }
      if (!tagFound) {
        return getErrorObject("InvalidXml", "Start tag expected.", 1);
      } else if (tags.length == 1) {
        return getErrorObject("InvalidTag", "Unclosed tag '" + tags[0].tagName + "'.", getLineNumberForPosition(xmlData, tags[0].tagStartPos));
      } else if (tags.length > 0) {
        return getErrorObject("InvalidXml", "Invalid '" + JSON.stringify(tags.map((t) => t.tagName), null, 4).replace(/\r?\n/g, "") + "' found.", { line: 1, col: 1 });
      }
      return true;
    };
    function isWhiteSpace(char) {
      return char === " " || char === "	" || char === "\n" || char === "\r";
    }
    function readPI(xmlData, i) {
      const start = i;
      for (; i < xmlData.length; i++) {
        if (xmlData[i] == "?" || xmlData[i] == " ") {
          const tagname = xmlData.substr(start, i - start);
          if (i > 5 && tagname === "xml") {
            return getErrorObject("InvalidXml", "XML declaration allowed only at the start of the document.", getLineNumberForPosition(xmlData, i));
          } else if (xmlData[i] == "?" && xmlData[i + 1] == ">") {
            i++;
            break;
          } else {
            continue;
          }
        }
      }
      return i;
    }
    function readCommentAndCDATA(xmlData, i) {
      if (xmlData.length > i + 5 && xmlData[i + 1] === "-" && xmlData[i + 2] === "-") {
        for (i += 3; i < xmlData.length; i++) {
          if (xmlData[i] === "-" && xmlData[i + 1] === "-" && xmlData[i + 2] === ">") {
            i += 2;
            break;
          }
        }
      } else if (xmlData.length > i + 8 && xmlData[i + 1] === "D" && xmlData[i + 2] === "O" && xmlData[i + 3] === "C" && xmlData[i + 4] === "T" && xmlData[i + 5] === "Y" && xmlData[i + 6] === "P" && xmlData[i + 7] === "E") {
        let angleBracketsCount = 1;
        for (i += 8; i < xmlData.length; i++) {
          if (xmlData[i] === "<") {
            angleBracketsCount++;
          } else if (xmlData[i] === ">") {
            angleBracketsCount--;
            if (angleBracketsCount === 0) {
              break;
            }
          }
        }
      } else if (xmlData.length > i + 9 && xmlData[i + 1] === "[" && xmlData[i + 2] === "C" && xmlData[i + 3] === "D" && xmlData[i + 4] === "A" && xmlData[i + 5] === "T" && xmlData[i + 6] === "A" && xmlData[i + 7] === "[") {
        for (i += 8; i < xmlData.length; i++) {
          if (xmlData[i] === "]" && xmlData[i + 1] === "]" && xmlData[i + 2] === ">") {
            i += 2;
            break;
          }
        }
      }
      return i;
    }
    var doubleQuote = '"';
    var singleQuote = "'";
    function readAttributeStr(xmlData, i) {
      let attrStr = "";
      let startChar = "";
      let tagClosed = false;
      for (; i < xmlData.length; i++) {
        if (xmlData[i] === doubleQuote || xmlData[i] === singleQuote) {
          if (startChar === "") {
            startChar = xmlData[i];
          } else if (startChar !== xmlData[i]) {
          } else {
            startChar = "";
          }
        } else if (xmlData[i] === ">") {
          if (startChar === "") {
            tagClosed = true;
            break;
          }
        }
        attrStr += xmlData[i];
      }
      if (startChar !== "") {
        return false;
      }
      return {
        value: attrStr,
        index: i,
        tagClosed
      };
    }
    var validAttrStrRegxp = new RegExp(`(\\s*)([^\\s=]+)(\\s*=)?(\\s*(['"])(([\\s\\S])*?)\\5)?`, "g");
    function validateAttributeString(attrStr, options) {
      const matches = util.getAllMatches(attrStr, validAttrStrRegxp);
      const attrNames = {};
      for (let i = 0; i < matches.length; i++) {
        if (matches[i][1].length === 0) {
          return getErrorObject("InvalidAttr", "Attribute '" + matches[i][2] + "' has no space in starting.", getPositionFromMatch(matches[i]));
        } else if (matches[i][3] !== void 0 && matches[i][4] === void 0) {
          return getErrorObject("InvalidAttr", "Attribute '" + matches[i][2] + "' is without value.", getPositionFromMatch(matches[i]));
        } else if (matches[i][3] === void 0 && !options.allowBooleanAttributes) {
          return getErrorObject("InvalidAttr", "boolean attribute '" + matches[i][2] + "' is not allowed.", getPositionFromMatch(matches[i]));
        }
        const attrName = matches[i][2];
        if (!validateAttrName(attrName)) {
          return getErrorObject("InvalidAttr", "Attribute '" + attrName + "' is an invalid name.", getPositionFromMatch(matches[i]));
        }
        if (!attrNames.hasOwnProperty(attrName)) {
          attrNames[attrName] = 1;
        } else {
          return getErrorObject("InvalidAttr", "Attribute '" + attrName + "' is repeated.", getPositionFromMatch(matches[i]));
        }
      }
      return true;
    }
    function validateNumberAmpersand(xmlData, i) {
      let re = /\d/;
      if (xmlData[i] === "x") {
        i++;
        re = /[\da-fA-F]/;
      }
      for (; i < xmlData.length; i++) {
        if (xmlData[i] === ";")
          return i;
        if (!xmlData[i].match(re))
          break;
      }
      return -1;
    }
    function validateAmpersand(xmlData, i) {
      i++;
      if (xmlData[i] === ";")
        return -1;
      if (xmlData[i] === "#") {
        i++;
        return validateNumberAmpersand(xmlData, i);
      }
      let count = 0;
      for (; i < xmlData.length; i++, count++) {
        if (xmlData[i].match(/\w/) && count < 20)
          continue;
        if (xmlData[i] === ";")
          break;
        return -1;
      }
      return i;
    }
    function getErrorObject(code, message, lineNumber) {
      return {
        err: {
          code,
          msg: message,
          line: lineNumber.line || lineNumber,
          col: lineNumber.col
        }
      };
    }
    function validateAttrName(attrName) {
      return util.isName(attrName);
    }
    function validateTagName(tagname) {
      return util.isName(tagname);
    }
    function getLineNumberForPosition(xmlData, index) {
      const lines = xmlData.substring(0, index).split(/\r?\n/);
      return {
        line: lines.length,
        // column number is last line's length + 1, because column numbering starts at 1:
        col: lines[lines.length - 1].length + 1
      };
    }
    function getPositionFromMatch(match) {
      return match.startIndex + match[1].length;
    }
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/OptionsBuilder.js
var require_OptionsBuilder = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/OptionsBuilder.js"(exports2) {
    var { DANGEROUS_PROPERTY_NAMES, criticalProperties } = require_util();
    var defaultOnDangerousProperty = (name) => {
      if (DANGEROUS_PROPERTY_NAMES.includes(name)) {
        return "__" + name;
      }
      return name;
    };
    var defaultOptions = {
      preserveOrder: false,
      attributeNamePrefix: "@_",
      attributesGroupName: false,
      textNodeName: "#text",
      ignoreAttributes: true,
      removeNSPrefix: false,
      // remove NS from tag name or attribute name if true
      allowBooleanAttributes: false,
      //a tag can have attributes without any value
      //ignoreRootElement : false,
      parseTagValue: true,
      parseAttributeValue: false,
      trimValues: true,
      //Trim string values of tag and attributes
      cdataPropName: false,
      numberParseOptions: {
        hex: true,
        leadingZeros: true,
        eNotation: true
      },
      tagValueProcessor: function(tagName, val) {
        return val;
      },
      attributeValueProcessor: function(attrName, val) {
        return val;
      },
      stopNodes: [],
      //nested tags will not be parsed even for errors
      alwaysCreateTextNode: false,
      isArray: () => false,
      commentPropName: false,
      unpairedTags: [],
      processEntities: true,
      htmlEntities: false,
      ignoreDeclaration: false,
      ignorePiTags: false,
      transformTagName: false,
      transformAttributeName: false,
      updateTag: function(tagName, jPath, attrs) {
        return tagName;
      },
      // skipEmptyListItem: false
      captureMetaData: false,
      maxNestedTags: 100,
      strictReservedNames: true,
      onDangerousProperty: defaultOnDangerousProperty
    };
    function validatePropertyName(propertyName, optionName) {
      if (typeof propertyName !== "string") {
        return;
      }
      const normalized = propertyName.toLowerCase();
      if (DANGEROUS_PROPERTY_NAMES.some((dangerous) => normalized === dangerous.toLowerCase())) {
        throw new Error(
          `[SECURITY] Invalid ${optionName}: "${propertyName}" is a reserved JavaScript keyword that could cause prototype pollution`
        );
      }
      if (criticalProperties.some((dangerous) => normalized === dangerous.toLowerCase())) {
        throw new Error(
          `[SECURITY] Invalid ${optionName}: "${propertyName}" is a reserved JavaScript keyword that could cause prototype pollution`
        );
      }
    }
    function normalizeProcessEntities(value) {
      if (typeof value === "boolean") {
        return {
          enabled: value,
          // true or false
          maxEntitySize: 1e4,
          maxExpansionDepth: 10,
          maxTotalExpansions: 1e3,
          maxExpandedLength: 1e5,
          allowedTags: null,
          tagFilter: null
        };
      }
      if (typeof value === "object" && value !== null) {
        return {
          enabled: value.enabled !== false,
          maxEntitySize: Math.max(1, value.maxEntitySize ?? 1e4),
          maxExpansionDepth: Math.max(1, value.maxExpansionDepth ?? 1e4),
          maxTotalExpansions: Math.max(1, value.maxTotalExpansions ?? Infinity),
          maxExpandedLength: Math.max(1, value.maxExpandedLength ?? 1e5),
          maxEntityCount: Math.max(1, value.maxEntityCount ?? 1e3),
          allowedTags: value.allowedTags ?? null,
          tagFilter: value.tagFilter ?? null
        };
      }
      return normalizeProcessEntities(true);
    }
    var buildOptions = function(options) {
      const built = Object.assign({}, defaultOptions, options);
      const propertyNameOptions = [
        { value: built.attributeNamePrefix, name: "attributeNamePrefix" },
        { value: built.attributesGroupName, name: "attributesGroupName" },
        { value: built.textNodeName, name: "textNodeName" },
        { value: built.cdataPropName, name: "cdataPropName" },
        { value: built.commentPropName, name: "commentPropName" }
      ];
      for (const { value, name } of propertyNameOptions) {
        if (value) {
          validatePropertyName(value, name);
        }
      }
      if (built.onDangerousProperty === null) {
        built.onDangerousProperty = defaultOnDangerousProperty;
      }
      built.processEntities = normalizeProcessEntities(built.processEntities);
      return built;
    };
    exports2.buildOptions = buildOptions;
    exports2.defaultOptions = defaultOptions;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/xmlNode.js
var require_xmlNode = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/xmlNode.js"(exports2, module2) {
    "use strict";
    var XmlNode = class {
      constructor(tagname) {
        this.tagname = tagname;
        this.child = [];
        this[":@"] = {};
      }
      add(key, val) {
        if (key === "__proto__") key = "#__proto__";
        this.child.push({ [key]: val });
      }
      addChild(node) {
        if (node.tagname === "__proto__") node.tagname = "#__proto__";
        if (node[":@"] && Object.keys(node[":@"]).length > 0) {
          this.child.push({ [node.tagname]: node.child, [":@"]: node[":@"] });
        } else {
          this.child.push({ [node.tagname]: node.child });
        }
      }
    };
    module2.exports = XmlNode;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/DocTypeReader.js
var require_DocTypeReader = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/DocTypeReader.js"(exports2, module2) {
    var util = require_util();
    var DocTypeReader = class {
      constructor(options) {
        this.suppressValidationErr = !options;
        this.options = options || {};
      }
      readDocType(xmlData, i) {
        const entities = /* @__PURE__ */ Object.create(null);
        let entityCount = 0;
        if (xmlData[i + 3] === "O" && xmlData[i + 4] === "C" && xmlData[i + 5] === "T" && xmlData[i + 6] === "Y" && xmlData[i + 7] === "P" && xmlData[i + 8] === "E") {
          i = i + 9;
          let angleBracketsCount = 1;
          let hasBody = false, comment = false;
          let exp = "";
          for (; i < xmlData.length; i++) {
            if (xmlData[i] === "<" && !comment) {
              if (hasBody && hasSeq(xmlData, "!ENTITY", i)) {
                i += 7;
                let entityName, val;
                [entityName, val, i] = this.readEntityExp(xmlData, i + 1, this.suppressValidationErr);
                if (val.indexOf("&") === -1) {
                  if (this.options.enabled !== false && this.options.maxEntityCount != null && entityCount >= this.options.maxEntityCount) {
                    throw new Error(
                      `Entity count (${entityCount + 1}) exceeds maximum allowed (${this.options.maxEntityCount})`
                    );
                  }
                  const escaped = entityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  entities[entityName] = {
                    regx: RegExp(`&${escaped};`, "g"),
                    val
                  };
                  entityCount++;
                }
              } else if (hasBody && hasSeq(xmlData, "!ELEMENT", i)) {
                i += 8;
                const { index } = this.readElementExp(xmlData, i + 1);
                i = index;
              } else if (hasBody && hasSeq(xmlData, "!ATTLIST", i)) {
                i += 8;
              } else if (hasBody && hasSeq(xmlData, "!NOTATION", i)) {
                i += 9;
                const { index } = this.readNotationExp(xmlData, i + 1, this.suppressValidationErr);
                i = index;
              } else if (hasSeq(xmlData, "!--", i)) {
                comment = true;
              } else {
                throw new Error(`Invalid DOCTYPE`);
              }
              angleBracketsCount++;
              exp = "";
            } else if (xmlData[i] === ">") {
              if (comment) {
                if (xmlData[i - 1] === "-" && xmlData[i - 2] === "-") {
                  comment = false;
                  angleBracketsCount--;
                }
              } else {
                angleBracketsCount--;
              }
              if (angleBracketsCount === 0) {
                break;
              }
            } else if (xmlData[i] === "[") {
              hasBody = true;
            } else {
              exp += xmlData[i];
            }
          }
          if (angleBracketsCount !== 0) {
            throw new Error(`Unclosed DOCTYPE`);
          }
        } else {
          throw new Error(`Invalid Tag instead of DOCTYPE`);
        }
        return { entities, i };
      }
      readEntityExp(xmlData, i) {
        i = skipWhitespace(xmlData, i);
        let entityName = "";
        while (i < xmlData.length && !/\s/.test(xmlData[i]) && xmlData[i] !== '"' && xmlData[i] !== "'") {
          entityName += xmlData[i];
          i++;
        }
        validateEntityName(entityName);
        i = skipWhitespace(xmlData, i);
        if (!this.suppressValidationErr) {
          if (xmlData.substring(i, i + 6).toUpperCase() === "SYSTEM") {
            throw new Error("External entities are not supported");
          } else if (xmlData[i] === "%") {
            throw new Error("Parameter entities are not supported");
          }
        }
        let entityValue = "";
        [i, entityValue] = this.readIdentifierVal(xmlData, i, "entity");
        if (this.options.enabled !== false && this.options.maxEntitySize != null && entityValue.length > this.options.maxEntitySize) {
          throw new Error(
            `Entity "${entityName}" size (${entityValue.length}) exceeds maximum allowed size (${this.options.maxEntitySize})`
          );
        }
        i--;
        return [entityName, entityValue, i];
      }
      readNotationExp(xmlData, i) {
        i = skipWhitespace(xmlData, i);
        let notationName = "";
        while (i < xmlData.length && !/\s/.test(xmlData[i])) {
          notationName += xmlData[i];
          i++;
        }
        !this.suppressValidationErr && validateEntityName(notationName);
        i = skipWhitespace(xmlData, i);
        const identifierType = xmlData.substring(i, i + 6).toUpperCase();
        if (!this.suppressValidationErr && identifierType !== "SYSTEM" && identifierType !== "PUBLIC") {
          throw new Error(`Expected SYSTEM or PUBLIC, found "${identifierType}"`);
        }
        i += identifierType.length;
        i = skipWhitespace(xmlData, i);
        let publicIdentifier = null;
        let systemIdentifier = null;
        if (identifierType === "PUBLIC") {
          [i, publicIdentifier] = this.readIdentifierVal(xmlData, i, "publicIdentifier");
          i = skipWhitespace(xmlData, i);
          if (xmlData[i] === '"' || xmlData[i] === "'") {
            [i, systemIdentifier] = this.readIdentifierVal(xmlData, i, "systemIdentifier");
          }
        } else if (identifierType === "SYSTEM") {
          [i, systemIdentifier] = this.readIdentifierVal(xmlData, i, "systemIdentifier");
          if (!this.suppressValidationErr && !systemIdentifier) {
            throw new Error("Missing mandatory system identifier for SYSTEM notation");
          }
        }
        return { notationName, publicIdentifier, systemIdentifier, index: --i };
      }
      readIdentifierVal(xmlData, i, type) {
        let identifierVal = "";
        const startChar = xmlData[i];
        if (startChar !== '"' && startChar !== "'") {
          throw new Error(`Expected quoted string, found "${startChar}"`);
        }
        i++;
        while (i < xmlData.length && xmlData[i] !== startChar) {
          identifierVal += xmlData[i];
          i++;
        }
        if (xmlData[i] !== startChar) {
          throw new Error(`Unterminated ${type} value`);
        }
        i++;
        return [i, identifierVal];
      }
      readElementExp(xmlData, i) {
        i = skipWhitespace(xmlData, i);
        let elementName = "";
        while (i < xmlData.length && !/\s/.test(xmlData[i])) {
          elementName += xmlData[i];
          i++;
        }
        if (!this.suppressValidationErr && !util.isName(elementName)) {
          throw new Error(`Invalid element name: "${elementName}"`);
        }
        i = skipWhitespace(xmlData, i);
        let contentModel = "";
        if (xmlData[i] === "E" && hasSeq(xmlData, "MPTY", i)) {
          i += 4;
        } else if (xmlData[i] === "A" && hasSeq(xmlData, "NY", i)) {
          i += 2;
        } else if (xmlData[i] === "(") {
          i++;
          while (i < xmlData.length && xmlData[i] !== ")") {
            contentModel += xmlData[i];
            i++;
          }
          if (xmlData[i] !== ")") {
            throw new Error("Unterminated content model");
          }
        } else if (!this.suppressValidationErr) {
          throw new Error(`Invalid Element Expression, found "${xmlData[i]}"`);
        }
        return {
          elementName,
          contentModel: contentModel.trim(),
          index: i
        };
      }
      readAttlistExp(xmlData, i) {
        i = skipWhitespace(xmlData, i);
        let elementName = "";
        while (i < xmlData.length && !/\s/.test(xmlData[i])) {
          elementName += xmlData[i];
          i++;
        }
        validateEntityName(elementName);
        i = skipWhitespace(xmlData, i);
        let attributeName = "";
        while (i < xmlData.length && !/\s/.test(xmlData[i])) {
          attributeName += xmlData[i];
          i++;
        }
        if (!validateEntityName(attributeName)) {
          throw new Error(`Invalid attribute name: "${attributeName}"`);
        }
        i = skipWhitespace(xmlData, i);
        let attributeType = "";
        if (xmlData.substring(i, i + 8).toUpperCase() === "NOTATION") {
          attributeType = "NOTATION";
          i += 8;
          i = skipWhitespace(xmlData, i);
          if (xmlData[i] !== "(") {
            throw new Error(`Expected '(', found "${xmlData[i]}"`);
          }
          i++;
          let allowedNotations = [];
          while (i < xmlData.length && xmlData[i] !== ")") {
            let notation = "";
            while (i < xmlData.length && xmlData[i] !== "|" && xmlData[i] !== ")") {
              notation += xmlData[i];
              i++;
            }
            notation = notation.trim();
            if (!validateEntityName(notation)) {
              throw new Error(`Invalid notation name: "${notation}"`);
            }
            allowedNotations.push(notation);
            if (xmlData[i] === "|") {
              i++;
              i = skipWhitespace(xmlData, i);
            }
          }
          if (xmlData[i] !== ")") {
            throw new Error("Unterminated list of notations");
          }
          i++;
          attributeType += " (" + allowedNotations.join("|") + ")";
        } else {
          while (i < xmlData.length && !/\s/.test(xmlData[i])) {
            attributeType += xmlData[i];
            i++;
          }
          const validTypes = ["CDATA", "ID", "IDREF", "IDREFS", "ENTITY", "ENTITIES", "NMTOKEN", "NMTOKENS"];
          if (!this.suppressValidationErr && !validTypes.includes(attributeType.toUpperCase())) {
            throw new Error(`Invalid attribute type: "${attributeType}"`);
          }
        }
        i = skipWhitespace(xmlData, i);
        let defaultValue = "";
        if (xmlData.substring(i, i + 8).toUpperCase() === "#REQUIRED") {
          defaultValue = "#REQUIRED";
          i += 8;
        } else if (xmlData.substring(i, i + 7).toUpperCase() === "#IMPLIED") {
          defaultValue = "#IMPLIED";
          i += 7;
        } else {
          [i, defaultValue] = this.readIdentifierVal(xmlData, i, "ATTLIST");
        }
        return {
          elementName,
          attributeName,
          attributeType,
          defaultValue,
          index: i
        };
      }
    };
    var skipWhitespace = (data, index) => {
      while (index < data.length && /\s/.test(data[index])) {
        index++;
      }
      return index;
    };
    function hasSeq(data, seq, i) {
      for (let j = 0; j < seq.length; j++) {
        if (seq[j] !== data[i + j + 1]) return false;
      }
      return true;
    }
    function validateEntityName(name) {
      if (util.isName(name))
        return name;
      else
        throw new Error(`Invalid entity name ${name}`);
    }
    module2.exports = DocTypeReader;
  }
});

// node_modules/.pnpm/strnum@1.1.2/node_modules/strnum/strnum.js
var require_strnum = __commonJS({
  "node_modules/.pnpm/strnum@1.1.2/node_modules/strnum/strnum.js"(exports2, module2) {
    var hexRegex = /^[-+]?0x[a-fA-F0-9]+$/;
    var numRegex = /^([\-\+])?(0*)([0-9]*(\.[0-9]*)?)$/;
    var consider = {
      hex: true,
      // oct: false,
      leadingZeros: true,
      decimalPoint: ".",
      eNotation: true
      //skipLike: /regex/
    };
    function toNumber(str, options = {}) {
      options = Object.assign({}, consider, options);
      if (!str || typeof str !== "string") return str;
      let trimmedStr = str.trim();
      if (options.skipLike !== void 0 && options.skipLike.test(trimmedStr)) return str;
      else if (str === "0") return 0;
      else if (options.hex && hexRegex.test(trimmedStr)) {
        return parse_int(trimmedStr, 16);
      } else if (trimmedStr.search(/[eE]/) !== -1) {
        const notation = trimmedStr.match(/^([-\+])?(0*)([0-9]*(\.[0-9]*)?[eE][-\+]?[0-9]+)$/);
        if (notation) {
          if (options.leadingZeros) {
            trimmedStr = (notation[1] || "") + notation[3];
          } else {
            if (notation[2] === "0" && notation[3][0] === ".") {
            } else {
              return str;
            }
          }
          return options.eNotation ? Number(trimmedStr) : str;
        } else {
          return str;
        }
      } else {
        const match = numRegex.exec(trimmedStr);
        if (match) {
          const sign = match[1];
          const leadingZeros = match[2];
          let numTrimmedByZeros = trimZeros(match[3]);
          if (!options.leadingZeros && leadingZeros.length > 0 && sign && trimmedStr[2] !== ".") return str;
          else if (!options.leadingZeros && leadingZeros.length > 0 && !sign && trimmedStr[1] !== ".") return str;
          else if (options.leadingZeros && leadingZeros === str) return 0;
          else {
            const num2 = Number(trimmedStr);
            const numStr = "" + num2;
            if (numStr.search(/[eE]/) !== -1) {
              if (options.eNotation) return num2;
              else return str;
            } else if (trimmedStr.indexOf(".") !== -1) {
              if (numStr === "0" && numTrimmedByZeros === "") return num2;
              else if (numStr === numTrimmedByZeros) return num2;
              else if (sign && numStr === "-" + numTrimmedByZeros) return num2;
              else return str;
            }
            if (leadingZeros) {
              return numTrimmedByZeros === numStr || sign + numTrimmedByZeros === numStr ? num2 : str;
            } else {
              return trimmedStr === numStr || trimmedStr === sign + numStr ? num2 : str;
            }
          }
        } else {
          return str;
        }
      }
    }
    function trimZeros(numStr) {
      if (numStr && numStr.indexOf(".") !== -1) {
        numStr = numStr.replace(/0+$/, "");
        if (numStr === ".") numStr = "0";
        else if (numStr[0] === ".") numStr = "0" + numStr;
        else if (numStr[numStr.length - 1] === ".") numStr = numStr.substr(0, numStr.length - 1);
        return numStr;
      }
      return numStr;
    }
    function parse_int(numStr, base) {
      if (parseInt) return parseInt(numStr, base);
      else if (Number.parseInt) return Number.parseInt(numStr, base);
      else if (window && window.parseInt) return window.parseInt(numStr, base);
      else throw new Error("parseInt, Number.parseInt, window.parseInt are not supported");
    }
    module2.exports = toNumber;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/ignoreAttributes.js
var require_ignoreAttributes = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/ignoreAttributes.js"(exports2, module2) {
    function getIgnoreAttributesFn(ignoreAttributes) {
      if (typeof ignoreAttributes === "function") {
        return ignoreAttributes;
      }
      if (Array.isArray(ignoreAttributes)) {
        return (attrName) => {
          for (const pattern of ignoreAttributes) {
            if (typeof pattern === "string" && attrName === pattern) {
              return true;
            }
            if (pattern instanceof RegExp && pattern.test(attrName)) {
              return true;
            }
          }
        };
      }
      return () => false;
    }
    module2.exports = getIgnoreAttributesFn;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/OrderedObjParser.js
var require_OrderedObjParser = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/OrderedObjParser.js"(exports2, module2) {
    "use strict";
    var util = require_util();
    var xmlNode = require_xmlNode();
    var DocTypeReader = require_DocTypeReader();
    var toNumber = require_strnum();
    var getIgnoreAttributesFn = require_ignoreAttributes();
    var OrderedObjParser = class {
      constructor(options) {
        this.options = options;
        this.currentNode = null;
        this.tagsNodeStack = [];
        this.docTypeEntities = {};
        this.lastEntities = {
          "apos": { regex: /&(apos|#39|#x27);/g, val: "'" },
          "gt": { regex: /&(gt|#62|#x3E);/g, val: ">" },
          "lt": { regex: /&(lt|#60|#x3C);/g, val: "<" },
          "quot": { regex: /&(quot|#34|#x22);/g, val: '"' }
        };
        this.ampEntity = { regex: /&(amp|#38|#x26);/g, val: "&" };
        this.htmlEntities = {
          "space": { regex: /&(nbsp|#160);/g, val: " " },
          // "lt" : { regex: /&(lt|#60);/g, val: "<" },
          // "gt" : { regex: /&(gt|#62);/g, val: ">" },
          // "amp" : { regex: /&(amp|#38);/g, val: "&" },
          // "quot" : { regex: /&(quot|#34);/g, val: "\"" },
          // "apos" : { regex: /&(apos|#39);/g, val: "'" },
          "cent": { regex: /&(cent|#162);/g, val: "\xA2" },
          "pound": { regex: /&(pound|#163);/g, val: "\xA3" },
          "yen": { regex: /&(yen|#165);/g, val: "\xA5" },
          "euro": { regex: /&(euro|#8364);/g, val: "\u20AC" },
          "copyright": { regex: /&(copy|#169);/g, val: "\xA9" },
          "reg": { regex: /&(reg|#174);/g, val: "\xAE" },
          "inr": { regex: /&(inr|#8377);/g, val: "\u20B9" },
          "num_dec": { regex: /&#([0-9]{1,7});/g, val: (_, str) => fromCodePoint(str, 10, "&#") },
          "num_hex": { regex: /&#x([0-9a-fA-F]{1,6});/g, val: (_, str) => fromCodePoint(str, 16, "&#x") }
        };
        this.addExternalEntities = addExternalEntities;
        this.parseXml = parseXml;
        this.parseTextData = parseTextData;
        this.resolveNameSpace = resolveNameSpace;
        this.buildAttributesMap = buildAttributesMap;
        this.isItStopNode = isItStopNode;
        this.replaceEntitiesValue = replaceEntitiesValue;
        this.readStopNodeData = readStopNodeData;
        this.saveTextToParentTag = saveTextToParentTag;
        this.addChild = addChild;
        this.ignoreAttributesFn = getIgnoreAttributesFn(this.options.ignoreAttributes);
        this.entityExpansionCount = 0;
        this.currentExpandedLength = 0;
        if (this.options.stopNodes && this.options.stopNodes.length > 0) {
          this.stopNodesExact = /* @__PURE__ */ new Set();
          this.stopNodesWildcard = /* @__PURE__ */ new Set();
          for (let i = 0; i < this.options.stopNodes.length; i++) {
            const stopNodeExp = this.options.stopNodes[i];
            if (typeof stopNodeExp !== "string") continue;
            if (stopNodeExp.startsWith("*.")) {
              this.stopNodesWildcard.add(stopNodeExp.substring(2));
            } else {
              this.stopNodesExact.add(stopNodeExp);
            }
          }
        }
      }
    };
    function addExternalEntities(externalEntities) {
      const entKeys = Object.keys(externalEntities);
      for (let i = 0; i < entKeys.length; i++) {
        const ent = entKeys[i];
        const escaped = ent.replace(/[.\-+*:]/g, "\\.");
        this.lastEntities[ent] = {
          regex: new RegExp("&" + escaped + ";", "g"),
          val: externalEntities[ent]
        };
      }
    }
    function parseTextData(val, tagName, jPath, dontTrim, hasAttributes, isLeafNode, escapeEntities) {
      if (val !== void 0) {
        if (this.options.trimValues && !dontTrim) {
          val = val.trim();
        }
        if (val.length > 0) {
          if (!escapeEntities) val = this.replaceEntitiesValue(val, tagName, jPath);
          const newval = this.options.tagValueProcessor(tagName, val, jPath, hasAttributes, isLeafNode);
          if (newval === null || newval === void 0) {
            return val;
          } else if (typeof newval !== typeof val || newval !== val) {
            return newval;
          } else if (this.options.trimValues) {
            return parseValue(val, this.options.parseTagValue, this.options.numberParseOptions);
          } else {
            const trimmedVal = val.trim();
            if (trimmedVal === val) {
              return parseValue(val, this.options.parseTagValue, this.options.numberParseOptions);
            } else {
              return val;
            }
          }
        }
      }
    }
    function resolveNameSpace(tagname) {
      if (this.options.removeNSPrefix) {
        const tags = tagname.split(":");
        const prefix = tagname.charAt(0) === "/" ? "/" : "";
        if (tags[0] === "xmlns") {
          return "";
        }
        if (tags.length === 2) {
          tagname = prefix + tags[1];
        }
      }
      return tagname;
    }
    var attrsRegx = new RegExp(`([^\\s=]+)\\s*(=\\s*(['"])([\\s\\S]*?)\\3)?`, "gm");
    function buildAttributesMap(attrStr, jPath, tagName) {
      if (this.options.ignoreAttributes !== true && typeof attrStr === "string") {
        const matches = util.getAllMatches(attrStr, attrsRegx);
        const len = matches.length;
        const attrs = {};
        for (let i = 0; i < len; i++) {
          const attrName = this.resolveNameSpace(matches[i][1]);
          if (this.ignoreAttributesFn(attrName, jPath)) {
            continue;
          }
          let oldVal = matches[i][4];
          let aName = this.options.attributeNamePrefix + attrName;
          if (attrName.length) {
            if (this.options.transformAttributeName) {
              aName = this.options.transformAttributeName(aName);
            }
            aName = sanitizeName(aName, this.options);
            if (oldVal !== void 0) {
              if (this.options.trimValues) {
                oldVal = oldVal.trim();
              }
              oldVal = this.replaceEntitiesValue(oldVal, tagName, jPath);
              const newVal = this.options.attributeValueProcessor(attrName, oldVal, jPath);
              if (newVal === null || newVal === void 0) {
                attrs[aName] = oldVal;
              } else if (typeof newVal !== typeof oldVal || newVal !== oldVal) {
                attrs[aName] = newVal;
              } else {
                attrs[aName] = parseValue(
                  oldVal,
                  this.options.parseAttributeValue,
                  this.options.numberParseOptions
                );
              }
            } else if (this.options.allowBooleanAttributes) {
              attrs[aName] = true;
            }
          }
        }
        if (!Object.keys(attrs).length) {
          return;
        }
        if (this.options.attributesGroupName) {
          const attrCollection = {};
          attrCollection[this.options.attributesGroupName] = attrs;
          return attrCollection;
        }
        return attrs;
      }
    }
    var parseXml = function(xmlData) {
      xmlData = xmlData.replace(/\r\n?/g, "\n");
      const xmlObj = new xmlNode("!xml");
      let currentNode = xmlObj;
      let textData = "";
      let jPath = "";
      this.entityExpansionCount = 0;
      this.currentExpandedLength = 0;
      const docTypeReader = new DocTypeReader(this.options.processEntities);
      for (let i = 0; i < xmlData.length; i++) {
        const ch = xmlData[i];
        if (ch === "<") {
          if (xmlData[i + 1] === "/") {
            const closeIndex = findClosingIndex(xmlData, ">", i, "Closing Tag is not closed.");
            let tagName = xmlData.substring(i + 2, closeIndex).trim();
            if (this.options.removeNSPrefix) {
              const colonIndex = tagName.indexOf(":");
              if (colonIndex !== -1) {
                tagName = tagName.substr(colonIndex + 1);
              }
            }
            if (this.options.transformTagName) {
              tagName = this.options.transformTagName(tagName);
            }
            if (currentNode) {
              textData = this.saveTextToParentTag(textData, currentNode, jPath);
            }
            const lastTagName = jPath.substring(jPath.lastIndexOf(".") + 1);
            if (tagName && this.options.unpairedTags.indexOf(tagName) !== -1) {
              throw new Error(`Unpaired tag can not be used as closing tag: </${tagName}>`);
            }
            let propIndex = 0;
            if (lastTagName && this.options.unpairedTags.indexOf(lastTagName) !== -1) {
              propIndex = jPath.lastIndexOf(".", jPath.lastIndexOf(".") - 1);
              this.tagsNodeStack.pop();
            } else {
              propIndex = jPath.lastIndexOf(".");
            }
            jPath = jPath.substring(0, propIndex);
            currentNode = this.tagsNodeStack.pop();
            textData = "";
            i = closeIndex;
          } else if (xmlData[i + 1] === "?") {
            let tagData = readTagExp(xmlData, i, false, "?>");
            if (!tagData) throw new Error("Pi Tag is not closed.");
            textData = this.saveTextToParentTag(textData, currentNode, jPath);
            if (this.options.ignoreDeclaration && tagData.tagName === "?xml" || this.options.ignorePiTags) {
            } else {
              const childNode = new xmlNode(tagData.tagName);
              childNode.add(this.options.textNodeName, "");
              if (tagData.tagName !== tagData.tagExp && tagData.attrExpPresent) {
                childNode[":@"] = this.buildAttributesMap(tagData.tagExp, jPath, tagData.tagName);
              }
              this.addChild(currentNode, childNode, jPath, i);
            }
            i = tagData.closeIndex + 1;
          } else if (xmlData.substr(i + 1, 3) === "!--") {
            const endIndex = findClosingIndex(xmlData, "-->", i + 4, "Comment is not closed.");
            if (this.options.commentPropName) {
              const comment = xmlData.substring(i + 4, endIndex - 2);
              textData = this.saveTextToParentTag(textData, currentNode, jPath);
              currentNode.add(this.options.commentPropName, [{ [this.options.textNodeName]: comment }]);
            }
            i = endIndex;
          } else if (xmlData.substr(i + 1, 2) === "!D") {
            const result = docTypeReader.readDocType(xmlData, i);
            this.docTypeEntities = result.entities;
            i = result.i;
          } else if (xmlData.substr(i + 1, 2) === "![") {
            const closeIndex = findClosingIndex(xmlData, "]]>", i, "CDATA is not closed.") - 2;
            const tagExp = xmlData.substring(i + 9, closeIndex);
            textData = this.saveTextToParentTag(textData, currentNode, jPath);
            let val = this.parseTextData(tagExp, currentNode.tagname, jPath, true, false, true, true);
            if (val == void 0) val = "";
            if (this.options.cdataPropName) {
              currentNode.add(this.options.cdataPropName, [{ [this.options.textNodeName]: tagExp }]);
            } else {
              currentNode.add(this.options.textNodeName, val);
            }
            i = closeIndex + 2;
          } else {
            let result = readTagExp(xmlData, i, this.options.removeNSPrefix);
            let tagName = result.tagName;
            const rawTagName = result.rawTagName;
            let tagExp = result.tagExp;
            let attrExpPresent = result.attrExpPresent;
            let closeIndex = result.closeIndex;
            if (this.options.transformTagName) {
              const newTagName = this.options.transformTagName(tagName);
              if (tagExp === tagName) {
                tagExp = newTagName;
              }
              tagName = newTagName;
            }
            if (this.options.strictReservedNames && (tagName === this.options.commentPropName || tagName === this.options.cdataPropName || tagName === this.options.textNodeName || tagName === this.options.attributesGroupName)) {
              throw new Error(`Invalid tag name: ${tagName}`);
            }
            if (currentNode && textData) {
              if (currentNode.tagname !== "!xml") {
                textData = this.saveTextToParentTag(textData, currentNode, jPath, false);
              }
            }
            const lastTag = currentNode;
            if (lastTag && this.options.unpairedTags.indexOf(lastTag.tagname) !== -1) {
              currentNode = this.tagsNodeStack.pop();
              jPath = jPath.substring(0, jPath.lastIndexOf("."));
            }
            if (tagName !== xmlObj.tagname) {
              jPath += jPath ? "." + tagName : tagName;
            }
            const startIndex = i;
            if (this.isItStopNode(this.stopNodesExact, this.stopNodesWildcard, jPath, tagName)) {
              let tagContent = "";
              if (tagExp.length > 0 && tagExp.lastIndexOf("/") === tagExp.length - 1) {
                if (tagName[tagName.length - 1] === "/") {
                  tagName = tagName.substr(0, tagName.length - 1);
                  jPath = jPath.substr(0, jPath.length - 1);
                  tagExp = tagName;
                } else {
                  tagExp = tagExp.substr(0, tagExp.length - 1);
                }
                i = result.closeIndex;
              } else if (this.options.unpairedTags.indexOf(tagName) !== -1) {
                i = result.closeIndex;
              } else {
                const result2 = this.readStopNodeData(xmlData, rawTagName, closeIndex + 1);
                if (!result2) throw new Error(`Unexpected end of ${rawTagName}`);
                i = result2.i;
                tagContent = result2.tagContent;
              }
              const childNode = new xmlNode(tagName);
              if (tagName !== tagExp && attrExpPresent) {
                childNode[":@"] = this.buildAttributesMap(tagExp, jPath, tagName);
              }
              if (tagContent) {
                tagContent = this.parseTextData(tagContent, tagName, jPath, true, attrExpPresent, true, true);
              }
              jPath = jPath.substr(0, jPath.lastIndexOf("."));
              childNode.add(this.options.textNodeName, tagContent);
              this.addChild(currentNode, childNode, jPath, startIndex);
            } else {
              if (tagExp.length > 0 && tagExp.lastIndexOf("/") === tagExp.length - 1) {
                if (tagName[tagName.length - 1] === "/") {
                  tagName = tagName.substr(0, tagName.length - 1);
                  jPath = jPath.substr(0, jPath.length - 1);
                  tagExp = tagName;
                } else {
                  tagExp = tagExp.substr(0, tagExp.length - 1);
                }
                if (this.options.transformTagName) {
                  const newTagName = this.options.transformTagName(tagName);
                  if (tagExp === tagName) {
                    tagExp = newTagName;
                  }
                  tagName = newTagName;
                }
                const childNode = new xmlNode(tagName);
                if (tagName !== tagExp && attrExpPresent) {
                  childNode[":@"] = this.buildAttributesMap(tagExp, jPath, tagName);
                }
                this.addChild(currentNode, childNode, jPath, startIndex);
                jPath = jPath.substr(0, jPath.lastIndexOf("."));
              } else if (this.options.unpairedTags.indexOf(tagName) !== -1) {
                const childNode = new xmlNode(tagName);
                if (tagName !== tagExp && attrExpPresent) {
                  childNode[":@"] = this.buildAttributesMap(tagExp, jPath);
                }
                this.addChild(currentNode, childNode, jPath, startIndex);
                jPath = jPath.substr(0, jPath.lastIndexOf("."));
                i = result.closeIndex;
                continue;
              } else {
                const childNode = new xmlNode(tagName);
                if (this.tagsNodeStack.length > this.options.maxNestedTags) {
                  throw new Error("Maximum nested tags exceeded");
                }
                this.tagsNodeStack.push(currentNode);
                if (tagName !== tagExp && attrExpPresent) {
                  childNode[":@"] = this.buildAttributesMap(tagExp, jPath, tagName);
                }
                this.addChild(currentNode, childNode, jPath);
                currentNode = childNode;
              }
              textData = "";
              i = closeIndex;
            }
          }
        } else {
          textData += xmlData[i];
        }
      }
      return xmlObj.child;
    };
    function addChild(currentNode, childNode, jPath, startIndex) {
      if (!this.options.captureMetaData) startIndex = void 0;
      const result = this.options.updateTag(childNode.tagname, jPath, childNode[":@"]);
      if (result === false) {
      } else if (typeof result === "string") {
        childNode.tagname = result;
        currentNode.addChild(childNode, startIndex);
      } else {
        currentNode.addChild(childNode, startIndex);
      }
    }
    var replaceEntitiesValue = function(val, tagName, jPath) {
      if (val.indexOf("&") === -1) {
        return val;
      }
      const entityConfig = this.options.processEntities;
      if (!entityConfig.enabled) {
        return val;
      }
      if (entityConfig.allowedTags) {
        if (!entityConfig.allowedTags.includes(tagName)) {
          return val;
        }
      }
      if (entityConfig.tagFilter) {
        if (!entityConfig.tagFilter(tagName, jPath)) {
          return val;
        }
      }
      for (let entityName in this.docTypeEntities) {
        const entity = this.docTypeEntities[entityName];
        const matches = val.match(entity.regx);
        if (matches) {
          this.entityExpansionCount += matches.length;
          if (entityConfig.maxTotalExpansions && this.entityExpansionCount > entityConfig.maxTotalExpansions) {
            throw new Error(
              `Entity expansion limit exceeded: ${this.entityExpansionCount} > ${entityConfig.maxTotalExpansions}`
            );
          }
          const lengthBefore = val.length;
          val = val.replace(entity.regx, entity.val);
          if (entityConfig.maxExpandedLength) {
            this.currentExpandedLength += val.length - lengthBefore;
            if (this.currentExpandedLength > entityConfig.maxExpandedLength) {
              throw new Error(
                `Total expanded content size exceeded: ${this.currentExpandedLength} > ${entityConfig.maxExpandedLength}`
              );
            }
          }
        }
      }
      if (val.indexOf("&") === -1) return val;
      for (const entityName of Object.keys(this.lastEntities)) {
        const entity = this.lastEntities[entityName];
        const matches = val.match(entity.regex);
        if (matches) {
          this.entityExpansionCount += matches.length;
          if (entityConfig.maxTotalExpansions && this.entityExpansionCount > entityConfig.maxTotalExpansions) {
            throw new Error(
              `Entity expansion limit exceeded: ${this.entityExpansionCount} > ${entityConfig.maxTotalExpansions}`
            );
          }
        }
        val = val.replace(entity.regex, entity.val);
      }
      if (val.indexOf("&") === -1) return val;
      if (this.options.htmlEntities) {
        for (const entityName of Object.keys(this.htmlEntities)) {
          const entity = this.htmlEntities[entityName];
          const matches = val.match(entity.regex);
          if (matches) {
            this.entityExpansionCount += matches.length;
            if (entityConfig.maxTotalExpansions && this.entityExpansionCount > entityConfig.maxTotalExpansions) {
              throw new Error(
                `Entity expansion limit exceeded: ${this.entityExpansionCount} > ${entityConfig.maxTotalExpansions}`
              );
            }
          }
          val = val.replace(entity.regex, entity.val);
        }
      }
      val = val.replace(this.ampEntity.regex, this.ampEntity.val);
      return val;
    };
    function saveTextToParentTag(textData, parentNode, jPath, isLeafNode) {
      if (textData) {
        if (isLeafNode === void 0) isLeafNode = parentNode.child.length === 0;
        textData = this.parseTextData(
          textData,
          parentNode.tagname,
          jPath,
          false,
          parentNode[":@"] ? Object.keys(parentNode[":@"]).length !== 0 : false,
          isLeafNode
        );
        if (textData !== void 0 && textData !== "")
          parentNode.add(this.options.textNodeName, textData);
        textData = "";
      }
      return textData;
    }
    function isItStopNode(stopNodesExact, stopNodesWildcard, jPath, currentTagName) {
      if (stopNodesWildcard && stopNodesWildcard.has(currentTagName)) return true;
      if (stopNodesExact && stopNodesExact.has(jPath)) return true;
      return false;
    }
    function tagExpWithClosingIndex(xmlData, i, closingChar = ">") {
      let attrBoundary;
      let tagExp = "";
      for (let index = i; index < xmlData.length; index++) {
        let ch = xmlData[index];
        if (attrBoundary) {
          if (ch === attrBoundary) attrBoundary = "";
        } else if (ch === '"' || ch === "'") {
          attrBoundary = ch;
        } else if (ch === closingChar[0]) {
          if (closingChar[1]) {
            if (xmlData[index + 1] === closingChar[1]) {
              return {
                data: tagExp,
                index
              };
            }
          } else {
            return {
              data: tagExp,
              index
            };
          }
        } else if (ch === "	") {
          ch = " ";
        }
        tagExp += ch;
      }
    }
    function findClosingIndex(xmlData, str, i, errMsg) {
      const closingIndex = xmlData.indexOf(str, i);
      if (closingIndex === -1) {
        throw new Error(errMsg);
      } else {
        return closingIndex + str.length - 1;
      }
    }
    function readTagExp(xmlData, i, removeNSPrefix, closingChar = ">") {
      const result = tagExpWithClosingIndex(xmlData, i + 1, closingChar);
      if (!result) return;
      let tagExp = result.data;
      const closeIndex = result.index;
      const separatorIndex = tagExp.search(/\s/);
      let tagName = tagExp;
      let attrExpPresent = true;
      if (separatorIndex !== -1) {
        tagName = tagExp.substring(0, separatorIndex);
        tagExp = tagExp.substring(separatorIndex + 1).trimStart();
      }
      const rawTagName = tagName;
      if (removeNSPrefix) {
        const colonIndex = tagName.indexOf(":");
        if (colonIndex !== -1) {
          tagName = tagName.substr(colonIndex + 1);
          attrExpPresent = tagName !== result.data.substr(colonIndex + 1);
        }
      }
      return {
        tagName,
        tagExp,
        closeIndex,
        attrExpPresent,
        rawTagName
      };
    }
    function readStopNodeData(xmlData, tagName, i) {
      const startIndex = i;
      let openTagCount = 1;
      for (; i < xmlData.length; i++) {
        if (xmlData[i] === "<") {
          if (xmlData[i + 1] === "/") {
            const closeIndex = findClosingIndex(xmlData, ">", i, `${tagName} is not closed`);
            let closeTagName = xmlData.substring(i + 2, closeIndex).trim();
            if (closeTagName === tagName) {
              openTagCount--;
              if (openTagCount === 0) {
                return {
                  tagContent: xmlData.substring(startIndex, i),
                  i: closeIndex
                };
              }
            }
            i = closeIndex;
          } else if (xmlData[i + 1] === "?") {
            const closeIndex = findClosingIndex(xmlData, "?>", i + 1, "StopNode is not closed.");
            i = closeIndex;
          } else if (xmlData.substr(i + 1, 3) === "!--") {
            const closeIndex = findClosingIndex(xmlData, "-->", i + 3, "StopNode is not closed.");
            i = closeIndex;
          } else if (xmlData.substr(i + 1, 2) === "![") {
            const closeIndex = findClosingIndex(xmlData, "]]>", i, "StopNode is not closed.") - 2;
            i = closeIndex;
          } else {
            const tagData = readTagExp(xmlData, i, ">");
            if (tagData) {
              const openTagName = tagData && tagData.tagName;
              if (openTagName === tagName && tagData.tagExp[tagData.tagExp.length - 1] !== "/") {
                openTagCount++;
              }
              i = tagData.closeIndex;
            }
          }
        }
      }
    }
    function parseValue(val, shouldParse, options) {
      if (shouldParse && typeof val === "string") {
        const newval = val.trim();
        if (newval === "true") return true;
        else if (newval === "false") return false;
        else return toNumber(val, options);
      } else {
        if (util.isExist(val)) {
          return val;
        } else {
          return "";
        }
      }
    }
    function fromCodePoint(str, base, prefix) {
      const codePoint = Number.parseInt(str, base);
      if (codePoint >= 0 && codePoint <= 1114111) {
        return String.fromCodePoint(codePoint);
      } else {
        return prefix + str + ";";
      }
    }
    function sanitizeName(name, options) {
      if (util.criticalProperties.includes(name)) {
        throw new Error(`[SECURITY] Invalid name: "${name}" is a reserved JavaScript keyword that could cause prototype pollution`);
      } else if (util.DANGEROUS_PROPERTY_NAMES.includes(name)) {
        return options.onDangerousProperty(name);
      }
      return name;
    }
    module2.exports = OrderedObjParser;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/node2json.js
var require_node2json = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/node2json.js"(exports2) {
    "use strict";
    function prettify(node, options) {
      return compress(node, options);
    }
    function compress(arr, options, jPath) {
      let text;
      const compressedObj = {};
      for (let i = 0; i < arr.length; i++) {
        const tagObj = arr[i];
        const property = propName(tagObj);
        let newJpath = "";
        if (jPath === void 0) newJpath = property;
        else newJpath = jPath + "." + property;
        if (property === options.textNodeName) {
          if (text === void 0) text = tagObj[property];
          else text += "" + tagObj[property];
        } else if (property === void 0) {
          continue;
        } else if (tagObj[property]) {
          let val = compress(tagObj[property], options, newJpath);
          const isLeaf = isLeafTag(val, options);
          if (tagObj[":@"]) {
            assignAttributes(val, tagObj[":@"], newJpath, options);
          } else if (Object.keys(val).length === 1 && val[options.textNodeName] !== void 0 && !options.alwaysCreateTextNode) {
            val = val[options.textNodeName];
          } else if (Object.keys(val).length === 0) {
            if (options.alwaysCreateTextNode) val[options.textNodeName] = "";
            else val = "";
          }
          if (compressedObj[property] !== void 0 && compressedObj.hasOwnProperty(property)) {
            if (!Array.isArray(compressedObj[property])) {
              compressedObj[property] = [compressedObj[property]];
            }
            compressedObj[property].push(val);
          } else {
            if (options.isArray(property, newJpath, isLeaf)) {
              compressedObj[property] = [val];
            } else {
              compressedObj[property] = val;
            }
          }
        }
      }
      if (typeof text === "string") {
        if (text.length > 0) compressedObj[options.textNodeName] = text;
      } else if (text !== void 0) compressedObj[options.textNodeName] = text;
      return compressedObj;
    }
    function propName(obj) {
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key !== ":@") return key;
      }
    }
    function assignAttributes(obj, attrMap, jpath, options) {
      if (attrMap) {
        const keys = Object.keys(attrMap);
        const len = keys.length;
        for (let i = 0; i < len; i++) {
          const atrrName = keys[i];
          if (options.isArray(atrrName, jpath + "." + atrrName, true, true)) {
            obj[atrrName] = [attrMap[atrrName]];
          } else {
            obj[atrrName] = attrMap[atrrName];
          }
        }
      }
    }
    function isLeafTag(obj, options) {
      const { textNodeName } = options;
      const propCount = Object.keys(obj).length;
      if (propCount === 0) {
        return true;
      }
      if (propCount === 1 && (obj[textNodeName] || typeof obj[textNodeName] === "boolean" || obj[textNodeName] === 0)) {
        return true;
      }
      return false;
    }
    exports2.prettify = prettify;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/XMLParser.js
var require_XMLParser = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/XMLParser.js"(exports2, module2) {
    var { buildOptions } = require_OptionsBuilder();
    var OrderedObjParser = require_OrderedObjParser();
    var { prettify } = require_node2json();
    var validator = require_validator();
    var XMLParser2 = class {
      constructor(options) {
        this.externalEntities = {};
        this.options = buildOptions(options);
      }
      /**
       * Parse XML dats to JS object 
       * @param {string|Buffer} xmlData 
       * @param {boolean|Object} validationOption 
       */
      parse(xmlData, validationOption) {
        if (typeof xmlData === "string") {
        } else if (xmlData.toString) {
          xmlData = xmlData.toString();
        } else {
          throw new Error("XML data is accepted in String or Bytes[] form.");
        }
        if (validationOption) {
          if (validationOption === true) validationOption = {};
          const result = validator.validate(xmlData, validationOption);
          if (result !== true) {
            throw Error(`${result.err.msg}:${result.err.line}:${result.err.col}`);
          }
        }
        const orderedObjParser = new OrderedObjParser(this.options);
        orderedObjParser.addExternalEntities(this.externalEntities);
        const orderedResult = orderedObjParser.parseXml(xmlData);
        if (this.options.preserveOrder || orderedResult === void 0) return orderedResult;
        else return prettify(orderedResult, this.options);
      }
      /**
       * Add Entity which is not by default supported by this library
       * @param {string} key 
       * @param {string} value 
       */
      addEntity(key, value) {
        if (value.indexOf("&") !== -1) {
          throw new Error("Entity value can't have '&'");
        } else if (key.indexOf("&") !== -1 || key.indexOf(";") !== -1) {
          throw new Error("An entity must be set without '&' and ';'. Eg. use '#xD' for '&#xD;'");
        } else if (value === "&") {
          throw new Error("An entity with value '&' is not permitted");
        } else {
          this.externalEntities[key] = value;
        }
      }
    };
    module2.exports = XMLParser2;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlbuilder/orderedJs2Xml.js
var require_orderedJs2Xml = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlbuilder/orderedJs2Xml.js"(exports2, module2) {
    var EOL = "\n";
    function toXml(jArray, options) {
      let indentation = "";
      if (options.format && options.indentBy.length > 0) {
        indentation = EOL;
      }
      return arrToStr(jArray, options, "", indentation);
    }
    function arrToStr(arr, options, jPath, indentation) {
      let xmlStr = "";
      let isPreviousElementTag = false;
      if (!Array.isArray(arr)) {
        if (arr !== void 0 && arr !== null) {
          let text = arr.toString();
          text = replaceEntitiesValue(text, options);
          return text;
        }
        return "";
      }
      for (let i = 0; i < arr.length; i++) {
        const tagObj = arr[i];
        const tagName = propName(tagObj);
        if (tagName === void 0) continue;
        let newJPath = "";
        if (jPath.length === 0) newJPath = tagName;
        else newJPath = `${jPath}.${tagName}`;
        if (tagName === options.textNodeName) {
          let tagText = tagObj[tagName];
          if (!isStopNode(newJPath, options)) {
            tagText = options.tagValueProcessor(tagName, tagText);
            tagText = replaceEntitiesValue(tagText, options);
          }
          if (isPreviousElementTag) {
            xmlStr += indentation;
          }
          xmlStr += tagText;
          isPreviousElementTag = false;
          continue;
        } else if (tagName === options.cdataPropName) {
          if (isPreviousElementTag) {
            xmlStr += indentation;
          }
          xmlStr += `<![CDATA[${tagObj[tagName][0][options.textNodeName]}]]>`;
          isPreviousElementTag = false;
          continue;
        } else if (tagName === options.commentPropName) {
          xmlStr += indentation + `<!--${tagObj[tagName][0][options.textNodeName]}-->`;
          isPreviousElementTag = true;
          continue;
        } else if (tagName[0] === "?") {
          const attStr2 = attr_to_str(tagObj[":@"], options);
          const tempInd = tagName === "?xml" ? "" : indentation;
          let piTextNodeName = tagObj[tagName][0][options.textNodeName];
          piTextNodeName = piTextNodeName.length !== 0 ? " " + piTextNodeName : "";
          xmlStr += tempInd + `<${tagName}${piTextNodeName}${attStr2}?>`;
          isPreviousElementTag = true;
          continue;
        }
        let newIdentation = indentation;
        if (newIdentation !== "") {
          newIdentation += options.indentBy;
        }
        const attStr = attr_to_str(tagObj[":@"], options);
        const tagStart = indentation + `<${tagName}${attStr}`;
        const tagValue = arrToStr(tagObj[tagName], options, newJPath, newIdentation);
        if (options.unpairedTags.indexOf(tagName) !== -1) {
          if (options.suppressUnpairedNode) xmlStr += tagStart + ">";
          else xmlStr += tagStart + "/>";
        } else if ((!tagValue || tagValue.length === 0) && options.suppressEmptyNode) {
          xmlStr += tagStart + "/>";
        } else if (tagValue && tagValue.endsWith(">")) {
          xmlStr += tagStart + `>${tagValue}${indentation}</${tagName}>`;
        } else {
          xmlStr += tagStart + ">";
          if (tagValue && indentation !== "" && (tagValue.includes("/>") || tagValue.includes("</"))) {
            xmlStr += indentation + options.indentBy + tagValue + indentation;
          } else {
            xmlStr += tagValue;
          }
          xmlStr += `</${tagName}>`;
        }
        isPreviousElementTag = true;
      }
      return xmlStr;
    }
    function propName(obj) {
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        if (key !== ":@") return key;
      }
    }
    function attr_to_str(attrMap, options) {
      let attrStr = "";
      if (attrMap && !options.ignoreAttributes) {
        for (let attr in attrMap) {
          if (!Object.prototype.hasOwnProperty.call(attrMap, attr)) continue;
          let attrVal = options.attributeValueProcessor(attr, attrMap[attr]);
          attrVal = replaceEntitiesValue(attrVal, options);
          if (attrVal === true && options.suppressBooleanAttributes) {
            attrStr += ` ${attr.substr(options.attributeNamePrefix.length)}`;
          } else {
            attrStr += ` ${attr.substr(options.attributeNamePrefix.length)}="${attrVal}"`;
          }
        }
      }
      return attrStr;
    }
    function isStopNode(jPath, options) {
      jPath = jPath.substr(0, jPath.length - options.textNodeName.length - 1);
      let tagName = jPath.substr(jPath.lastIndexOf(".") + 1);
      for (let index in options.stopNodes) {
        if (options.stopNodes[index] === jPath || options.stopNodes[index] === "*." + tagName) return true;
      }
      return false;
    }
    function replaceEntitiesValue(textValue, options) {
      if (textValue && textValue.length > 0 && options.processEntities) {
        for (let i = 0; i < options.entities.length; i++) {
          const entity = options.entities[i];
          textValue = textValue.replace(entity.regex, entity.val);
        }
      }
      return textValue;
    }
    module2.exports = toXml;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlbuilder/json2xml.js
var require_json2xml = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlbuilder/json2xml.js"(exports2, module2) {
    "use strict";
    var buildFromOrderedJs = require_orderedJs2Xml();
    var getIgnoreAttributesFn = require_ignoreAttributes();
    var defaultOptions = {
      attributeNamePrefix: "@_",
      attributesGroupName: false,
      textNodeName: "#text",
      ignoreAttributes: true,
      cdataPropName: false,
      format: false,
      indentBy: "  ",
      suppressEmptyNode: false,
      suppressUnpairedNode: true,
      suppressBooleanAttributes: true,
      tagValueProcessor: function(key, a) {
        return a;
      },
      attributeValueProcessor: function(attrName, a) {
        return a;
      },
      preserveOrder: false,
      commentPropName: false,
      unpairedTags: [],
      entities: [
        { regex: new RegExp("&", "g"), val: "&amp;" },
        //it must be on top
        { regex: new RegExp(">", "g"), val: "&gt;" },
        { regex: new RegExp("<", "g"), val: "&lt;" },
        { regex: new RegExp("'", "g"), val: "&apos;" },
        { regex: new RegExp('"', "g"), val: "&quot;" }
      ],
      processEntities: true,
      stopNodes: [],
      // transformTagName: false,
      // transformAttributeName: false,
      oneListGroup: false
    };
    function Builder(options) {
      this.options = Object.assign({}, defaultOptions, options);
      if (this.options.ignoreAttributes === true || this.options.attributesGroupName) {
        this.isAttribute = function() {
          return false;
        };
      } else {
        this.ignoreAttributesFn = getIgnoreAttributesFn(this.options.ignoreAttributes);
        this.attrPrefixLen = this.options.attributeNamePrefix.length;
        this.isAttribute = isAttribute;
      }
      this.processTextOrObjNode = processTextOrObjNode;
      if (this.options.format) {
        this.indentate = indentate;
        this.tagEndChar = ">\n";
        this.newLine = "\n";
      } else {
        this.indentate = function() {
          return "";
        };
        this.tagEndChar = ">";
        this.newLine = "";
      }
    }
    Builder.prototype.build = function(jObj) {
      if (this.options.preserveOrder) {
        return buildFromOrderedJs(jObj, this.options);
      } else {
        if (Array.isArray(jObj) && this.options.arrayNodeName && this.options.arrayNodeName.length > 1) {
          jObj = {
            [this.options.arrayNodeName]: jObj
          };
        }
        return this.j2x(jObj, 0, []).val;
      }
    };
    Builder.prototype.j2x = function(jObj, level, ajPath) {
      let attrStr = "";
      let val = "";
      const jPath = ajPath.join(".");
      for (let key in jObj) {
        if (!Object.prototype.hasOwnProperty.call(jObj, key)) continue;
        if (typeof jObj[key] === "undefined") {
          if (this.isAttribute(key)) {
            val += "";
          }
        } else if (jObj[key] === null) {
          if (this.isAttribute(key)) {
            val += "";
          } else if (key === this.options.cdataPropName) {
            val += "";
          } else if (key[0] === "?") {
            val += this.indentate(level) + "<" + key + "?" + this.tagEndChar;
          } else {
            val += this.indentate(level) + "<" + key + "/" + this.tagEndChar;
          }
        } else if (jObj[key] instanceof Date) {
          val += this.buildTextValNode(jObj[key], key, "", level);
        } else if (typeof jObj[key] !== "object") {
          const attr = this.isAttribute(key);
          if (attr && !this.ignoreAttributesFn(attr, jPath)) {
            attrStr += this.buildAttrPairStr(attr, "" + jObj[key]);
          } else if (!attr) {
            if (key === this.options.textNodeName) {
              let newval = this.options.tagValueProcessor(key, "" + jObj[key]);
              val += this.replaceEntitiesValue(newval);
            } else {
              val += this.buildTextValNode(jObj[key], key, "", level);
            }
          }
        } else if (Array.isArray(jObj[key])) {
          const arrLen = jObj[key].length;
          let listTagVal = "";
          let listTagAttr = "";
          for (let j = 0; j < arrLen; j++) {
            const item = jObj[key][j];
            if (typeof item === "undefined") {
            } else if (item === null) {
              if (key[0] === "?") val += this.indentate(level) + "<" + key + "?" + this.tagEndChar;
              else val += this.indentate(level) + "<" + key + "/" + this.tagEndChar;
            } else if (typeof item === "object") {
              if (this.options.oneListGroup) {
                const result = this.j2x(item, level + 1, ajPath.concat(key));
                listTagVal += result.val;
                if (this.options.attributesGroupName && item.hasOwnProperty(this.options.attributesGroupName)) {
                  listTagAttr += result.attrStr;
                }
              } else {
                listTagVal += this.processTextOrObjNode(item, key, level, ajPath);
              }
            } else {
              if (this.options.oneListGroup) {
                let textValue = this.options.tagValueProcessor(key, item);
                textValue = this.replaceEntitiesValue(textValue);
                listTagVal += textValue;
              } else {
                listTagVal += this.buildTextValNode(item, key, "", level);
              }
            }
          }
          if (this.options.oneListGroup) {
            listTagVal = this.buildObjectNode(listTagVal, key, listTagAttr, level);
          }
          val += listTagVal;
        } else {
          if (this.options.attributesGroupName && key === this.options.attributesGroupName) {
            const Ks = Object.keys(jObj[key]);
            const L = Ks.length;
            for (let j = 0; j < L; j++) {
              attrStr += this.buildAttrPairStr(Ks[j], "" + jObj[key][Ks[j]]);
            }
          } else {
            val += this.processTextOrObjNode(jObj[key], key, level, ajPath);
          }
        }
      }
      return { attrStr, val };
    };
    Builder.prototype.buildAttrPairStr = function(attrName, val) {
      val = this.options.attributeValueProcessor(attrName, "" + val);
      val = this.replaceEntitiesValue(val);
      if (this.options.suppressBooleanAttributes && val === "true") {
        return " " + attrName;
      } else return " " + attrName + '="' + val + '"';
    };
    function processTextOrObjNode(object, key, level, ajPath) {
      const result = this.j2x(object, level + 1, ajPath.concat(key));
      if (object[this.options.textNodeName] !== void 0 && Object.keys(object).length === 1) {
        return this.buildTextValNode(object[this.options.textNodeName], key, result.attrStr, level);
      } else {
        return this.buildObjectNode(result.val, key, result.attrStr, level);
      }
    }
    Builder.prototype.buildObjectNode = function(val, key, attrStr, level) {
      if (val === "") {
        if (key[0] === "?") return this.indentate(level) + "<" + key + attrStr + "?" + this.tagEndChar;
        else {
          return this.indentate(level) + "<" + key + attrStr + this.closeTag(key) + this.tagEndChar;
        }
      } else {
        let tagEndExp = "</" + key + this.tagEndChar;
        let piClosingChar = "";
        if (key[0] === "?") {
          piClosingChar = "?";
          tagEndExp = "";
        }
        if ((attrStr || attrStr === "") && val.indexOf("<") === -1) {
          return this.indentate(level) + "<" + key + attrStr + piClosingChar + ">" + val + tagEndExp;
        } else if (this.options.commentPropName !== false && key === this.options.commentPropName && piClosingChar.length === 0) {
          return this.indentate(level) + `<!--${val}-->` + this.newLine;
        } else {
          return this.indentate(level) + "<" + key + attrStr + piClosingChar + this.tagEndChar + val + this.indentate(level) + tagEndExp;
        }
      }
    };
    Builder.prototype.closeTag = function(key) {
      let closeTag = "";
      if (this.options.unpairedTags.indexOf(key) !== -1) {
        if (!this.options.suppressUnpairedNode) closeTag = "/";
      } else if (this.options.suppressEmptyNode) {
        closeTag = "/";
      } else {
        closeTag = `></${key}`;
      }
      return closeTag;
    };
    Builder.prototype.buildTextValNode = function(val, key, attrStr, level) {
      if (this.options.cdataPropName !== false && key === this.options.cdataPropName) {
        return this.indentate(level) + `<![CDATA[${val}]]>` + this.newLine;
      } else if (this.options.commentPropName !== false && key === this.options.commentPropName) {
        return this.indentate(level) + `<!--${val}-->` + this.newLine;
      } else if (key[0] === "?") {
        return this.indentate(level) + "<" + key + attrStr + "?" + this.tagEndChar;
      } else {
        let textValue = this.options.tagValueProcessor(key, val);
        textValue = this.replaceEntitiesValue(textValue);
        if (textValue === "") {
          return this.indentate(level) + "<" + key + attrStr + this.closeTag(key) + this.tagEndChar;
        } else {
          return this.indentate(level) + "<" + key + attrStr + ">" + textValue + "</" + key + this.tagEndChar;
        }
      }
    };
    Builder.prototype.replaceEntitiesValue = function(textValue) {
      if (textValue && textValue.length > 0 && this.options.processEntities) {
        for (let i = 0; i < this.options.entities.length; i++) {
          const entity = this.options.entities[i];
          textValue = textValue.replace(entity.regex, entity.val);
        }
      }
      return textValue;
    };
    function indentate(level) {
      return this.options.indentBy.repeat(level);
    }
    function isAttribute(name) {
      if (name.startsWith(this.options.attributeNamePrefix) && name !== this.options.textNodeName) {
        return name.substr(this.attrPrefixLen);
      } else {
        return false;
      }
    }
    module2.exports = Builder;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/fxp.js
var require_fxp = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/fxp.js"(exports2, module2) {
    "use strict";
    var validator = require_validator();
    var XMLParser2 = require_XMLParser();
    var XMLBuilder = require_json2xml();
    module2.exports = {
      XMLParser: XMLParser2,
      XMLValidator: validator,
      XMLBuilder
    };
  }
});

// packages/pptx/src/index.ts
var src_exports = {};
__export(src_exports, {
  isParsedDeckWire: () => isParsedDeckWire,
  parsePptx: () => parsePptx,
  toWireDeck: () => toWireDeck
});
module.exports = __toCommonJS(src_exports);

// node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/esm/index.mjs
var import_module = require("module");
var require2 = (0, import_module.createRequire)("/");
var _a;
var Worker;
var isMarkedAsUntransferable;
try {
  _a = require2("worker_threads"), Worker = _a.Worker, isMarkedAsUntransferable = _a.isMarkedAsUntransferable;
} catch (e) {
}
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0; i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r = new i32(b[30]);
  for (var i = 1; i < 30; ++i) {
    for (var j = b[i]; j < b[i + 1]; ++j) {
      r[j] = j - b[i] << 5 | i;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = function(cd, mb, r) {
  var s = cd.length;
  var i = 0;
  var l = new u16(mb);
  for (; i < s; ++i) {
    if (cd[i])
      ++l[cd[i] - 1];
  }
  var le = new u16(mb);
  for (i = 1; i < mb; ++i) {
    le[i] = le[i - 1] + l[i - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        var sv = i << 4 | cd[i];
        var r_1 = mb - cd[i];
        var v = le[cd[i] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
      }
    }
  }
  return co;
};
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i = 1; i < a.length; ++i) {
    if (a[i] > m)
      m = a[i];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i = 0; i < hcLen; ++i) {
          clt[clim[i]] = bits(dat, pos + i * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i = 0; i < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i = sym - 257, b = fleb[i];
          add = bits(dat, pos, (1 << b) - 1) + fl[i];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var et = /* @__PURE__ */ new u8(0);
var b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
};
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
var dutf8 = function(d) {
  for (var r = "", i = 0; ; ) {
    var c = d[i++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i + eb > d.length)
      return { s: r, r: slc(d, i - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | d[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | d[i++] & 63);
  }
};
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i = 0; i < dat.length; i += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var slzh = function(d, b) {
  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
  var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
  var _a2 = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d, b + 10), sc, su, fn, es + efl + b2(d, b + 32), off];
};
var z64hs = function(d, b, l, z, sc, su, off) {
  var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
  var nf = nsc + nsu + noff;
  if (z && nf) {
    for (; b + 4 < e; b += 4 + b2(d, b + 2)) {
      if (b2(d, b) == 1) {
        return [
          nsc ? b8(d, b + 4 + 8 * nsu) : sc,
          nsu ? b8(d, b + 4) : su,
          noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
          1
        ];
      }
    }
    if (z < 2)
      err(13);
  }
  return [sc, su, off, 0];
};
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (; b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  ;
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = b4(data, e - 20) == 117853008;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i = 0; i < c; ++i) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}

// packages/pptx/src/index.ts
var import_fast_xml_parser = __toESM(require_fxp(), 1);
var EMU_PER_PX = 914400 / 96;
function toWireDeck(deck) {
  return {
    slideW: deck.slideW,
    slideH: deck.slideH,
    slides: deck.slides.map((s) => ({
      texts: s.texts,
      tables: s.tables,
      connectors: s.connectors,
      images: s.images.map((im) => ({
        x: im.x,
        y: im.y,
        width: im.width,
        height: im.height,
        ext: im.ext,
        base64: Buffer.from(im.bytes).toString("base64"),
        borderColor: im.borderColor,
        borderWidth: im.borderWidth,
        crop: im.crop
      })),
      ...s.background ? {
        background: {
          color: s.background.color,
          ...s.background.image ? { image: { ext: s.background.image.ext, base64: Buffer.from(s.background.image.bytes).toString("base64") } } : {}
        }
      } : {}
    }))
  };
}
function isParsedDeckWire(value) {
  if (!value || typeof value !== "object") return false;
  const d = value;
  if (typeof d.slideW !== "number" || typeof d.slideH !== "number" || !Array.isArray(d.slides)) return false;
  return d.slides.every((s) => {
    if (!s || typeof s !== "object") return false;
    const slide = s;
    return Array.isArray(slide.texts) && Array.isArray(slide.images);
  });
}
var parser = new import_fast_xml_parser.XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep arrays predictable for repeated nodes we walk.
  isArray: (name) => ["p:sp", "p:pic", "a:p", "a:r", "p:sldId", "p:grpSp", "p:cxnSp"].includes(name)
});
function emuToPx(emu) {
  return Math.round(emu / EMU_PER_PX);
}
function num(v) {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}
function posNum(v, fallback) {
  const n = num(v);
  return n > 0 ? n : fallback;
}
function clampFontPt(pt) {
  return Math.min(500, Math.max(1, pt));
}
function collect(node, key, out = []) {
  if (!node || typeof node !== "object") return out;
  const obj = node;
  for (const [k, v] of Object.entries(obj)) {
    if (k === key) {
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
    }
    if (v && typeof v === "object") collect(v, key, out);
  }
  return out;
}
function xfrmRectEmu(shape) {
  const xfrms = collect(shape, "a:xfrm");
  const xf = xfrms[0];
  if (!xf) return null;
  const off = xf["a:off"];
  const ext = xf["a:ext"];
  if (!off || !ext) return null;
  const width = num(ext["@_cx"]);
  const height = num(ext["@_cy"]);
  if (width <= 0 || height <= 0) return null;
  return { x: num(off["@_x"]), y: num(off["@_y"]), width, height };
}
function xfrmRect(shape) {
  const emu = xfrmRectEmu(shape);
  if (!emu) return null;
  return { x: emuToPx(emu.x), y: emuToPx(emu.y), width: emuToPx(emu.width), height: emuToPx(emu.height) };
}
var IDENTITY_TRANSFORM = (rect) => rect;
function groupTransform(grpSp) {
  const grpSpPr = collect(grpSp, "p:grpSpPr")[0];
  const xf = grpSpPr ? collect(grpSpPr, "a:xfrm")[0] : void 0;
  if (!xf) return IDENTITY_TRANSFORM;
  const off = xf["a:off"];
  const ext = xf["a:ext"];
  const chOff = xf["a:chOff"];
  const chExt = xf["a:chExt"];
  if (!off || !ext || !chOff || !chExt) return IDENTITY_TRANSFORM;
  const chExtCx = num(chExt["@_cx"]);
  const chExtCy = num(chExt["@_cy"]);
  if (chExtCx <= 0 || chExtCy <= 0) return IDENTITY_TRANSFORM;
  const offX = num(off["@_x"]);
  const offY = num(off["@_y"]);
  const chOffX = num(chOff["@_x"]);
  const chOffY = num(chOff["@_y"]);
  const scaleX = num(ext["@_cx"]) / chExtCx;
  const scaleY = num(ext["@_cy"]) / chExtCy;
  return (rect) => ({
    x: offX + (rect.x - chOffX) * scaleX,
    y: offY + (rect.y - chOffY) * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY
  });
}
function composeTransform(outer, inner) {
  return (rect) => outer(inner(rect));
}
var LINE_GEOM_PRESETS = /* @__PURE__ */ new Set([
  "line",
  "straightConnector1",
  "bentConnector2",
  "bentConnector3",
  "bentConnector4",
  "bentConnector5",
  "curvedConnector2",
  "curvedConnector3",
  "curvedConnector4",
  "curvedConnector5"
]);
function isLineGeomShape(sp) {
  const geom = collect(sp, "a:prstGeom")[0];
  const prst = geom?.["@_prst"];
  return typeof prst === "string" && LINE_GEOM_PRESETS.has(prst);
}
function collectSpTree(doc, transform = IDENTITY_TRANSFORM, out = { shapes: [], pics: [], connectors: [] }) {
  if (!doc || typeof doc !== "object") return out;
  const node = doc;
  for (const [k, v] of Object.entries(node)) {
    if (k === "p:sp") {
      for (const sp of v) {
        if (isLineGeomShape(sp)) out.connectors.push({ shape: sp, transform });
        else out.shapes.push({ shape: sp, transform });
      }
    } else if (k === "p:pic") {
      for (const pic of v) out.pics.push({ shape: pic, transform });
    } else if (k === "p:cxnSp") {
      for (const cxn of v) out.connectors.push({ shape: cxn, transform });
    } else if (k === "p:grpSp") {
      for (const grp of v) {
        collectSpTree(grp, composeTransform(transform, groupTransform(grp)), out);
      }
    } else if (v && typeof v === "object") {
      collectSpTree(v, transform, out);
    }
  }
  return out;
}
function clampBorderPx(px) {
  return Math.min(100, Math.max(0, px));
}
function directColor(node, scheme) {
  if (!node) return void 0;
  const srgb = node["a:srgbClr"];
  const v = srgb?.["@_val"];
  if (typeof v === "string" && /^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
  const sc = node["a:schemeClr"];
  const name = sc?.["@_val"];
  if (typeof name === "string" && scheme[name]) return scheme[name];
  return void 0;
}
function shapeFillAndLine(shape, scheme, fillStyles, lnStyles) {
  const spPr = collect(shape, "p:spPr")[0];
  const out = {};
  let literalFill = false;
  let literalLine = false;
  if (spPr) {
    if ("a:noFill" in spPr) {
      literalFill = true;
    } else {
      const fill = colorFromFill(spPr, scheme);
      if (fill) {
        out.fill = fill;
        literalFill = true;
      }
    }
    const ln = spPr["a:ln"];
    if (ln) {
      if ("a:noFill" in ln) {
        literalLine = true;
      } else {
        const borderColor = colorFromFill(ln, scheme);
        if (borderColor) {
          out.borderColor = borderColor;
          const w = num(ln["@_w"]);
          out.borderWidth = w > 0 ? clampBorderPx(emuToPx(w)) : 1;
          literalLine = true;
        }
      }
    }
  }
  const style = collect(shape, "p:style")[0];
  if (style) {
    if (!literalFill) {
      const fillRef = style["a:fillRef"];
      const idx = num(fillRef?.["@_idx"]);
      const base = directColor(fillRef, scheme);
      if (base && idx > 0) out.fill = applyColorMod(base, fillStyles[idx - 1]);
    }
    if (!literalLine) {
      const lnRef = style["a:lnRef"];
      const idx = num(lnRef?.["@_idx"]);
      const base = directColor(lnRef, scheme);
      if (base && idx > 0) {
        const lnStyle = lnStyles[idx - 1];
        out.borderColor = applyColorMod(base, lnStyle?.mod);
        out.borderWidth = lnStyle?.widthPx ?? 1;
      }
    }
  }
  return out;
}
function imageCrop(pic) {
  const blipFill = collect(pic, "p:blipFill")[0];
  const srcRect = blipFill?.["a:srcRect"];
  if (!srcRect) return void 0;
  const frac = (v) => Math.max(0, Math.min(1, num(v) / 1e5));
  const left = frac(srcRect["@_l"]);
  const top = frac(srcRect["@_t"]);
  const right = frac(srcRect["@_r"]);
  const bottom = frac(srcRect["@_b"]);
  if (!left && !top && !right && !bottom) return void 0;
  return { left, top, right, bottom };
}
function placeholderKey(shape) {
  const ph = collect(shape, "p:ph")[0];
  if (!ph) return null;
  return { type: String(ph["@_type"] ?? "body"), idx: String(ph["@_idx"] ?? "") };
}
function defRprStyle(sp, scheme) {
  const out = {};
  const ppr = collect(sp, "a:lvl1pPr")[0];
  const defRpr = collect(ppr ?? sp, "a:defRPr")[0];
  if (defRpr) {
    const sz = num(defRpr["@_sz"]);
    if (sz > 0) out.fontPt = sz / 100;
    if (defRpr["@_b"] === "1") out.bold = true;
    const c = colorFromFill(defRpr, scheme);
    if (c) out.color = c;
  }
  const algn = ppr?.["@_algn"];
  if (algn === "ctr") out.align = "center";
  else if (algn === "r") out.align = "right";
  else if (algn === "l") out.align = "left";
  return out;
}
function layoutInfo(files, slidePath, scheme) {
  const rects = /* @__PURE__ */ new Map();
  const styles = /* @__PURE__ */ new Map();
  const pics = [];
  const base = slidePath.split("/").pop();
  const relsXml = findFile(files, slidePath.replace(/[^/]+$/, "") + "_rels/" + base + ".rels");
  if (!relsXml) return { rects, styles, pics };
  const rels = parser.parse(strFromU8(relsXml));
  const layoutRel = collect(rels, "Relationship").find(
    (r) => String(r["@_Type"]).endsWith("/slideLayout")
  );
  if (!layoutRel) return { rects, styles, pics };
  const layoutName = String(layoutRel["@_Target"]).split("/").pop();
  const collectFrom = (xml, srcName) => {
    if (!xml) return;
    const doc = parser.parse(strFromU8(xml));
    for (const sp of collect(doc, "p:sp")) {
      const ph = placeholderKey(sp);
      const rect = xfrmRect(sp);
      if (ph) {
        const style = defRprStyle(sp, scheme);
        for (const k of [`${ph.type}|${ph.idx}`, `t:${ph.type}`, ...ph.idx ? [`i:${ph.idx}`] : []]) {
          if (rect && !rects.has(k)) rects.set(k, rect);
          if (Object.keys(style).length && !styles.has(k)) styles.set(k, style);
        }
      }
    }
    for (const pic of collect(doc, "p:pic")) {
      const rect = xfrmRect(pic) ?? phLookup(rects, placeholderKey(pic));
      const blip = collect(pic, "a:blip")[0];
      const relId = blip ? String(blip["@_r:embed"]) : "";
      if (rect && relId) pics.push({ rect, relId, layoutName: srcName });
    }
  };
  collectFrom(findFile(files, "ppt/slideLayouts/" + layoutName), layoutName);
  const layoutRelsXml = findFile(files, "ppt/slideLayouts/_rels/" + layoutName + ".rels");
  if (layoutRelsXml) {
    const lr = parser.parse(strFromU8(layoutRelsXml));
    const masterRel = collect(lr, "Relationship").find(
      (r) => String(r["@_Type"]).endsWith("/slideMaster")
    );
    if (masterRel) {
      const masterName = String(masterRel["@_Target"]).split("/").pop();
      collectFrom(findFile(files, "ppt/slideMasters/" + masterName), masterName);
    }
  }
  return { rects, styles, pics };
}
function phLookup(map, ph) {
  if (!ph) return void 0;
  const exact = map.get(`${ph.type}|${ph.idx}`);
  if (exact !== void 0) return exact;
  if (ph.idx) return map.get(`i:${ph.idx}`);
  return map.get(`t:${ph.type}`);
}
function resolveRectWithTransform(shape, rects, transform) {
  const emu = xfrmRectEmu(shape);
  if (emu) {
    const t = transform(emu);
    if (t.width > 0 && t.height > 0) {
      return { x: emuToPx(t.x), y: emuToPx(t.y), width: emuToPx(t.width), height: emuToPx(t.height) };
    }
  }
  return phLookup(rects, placeholderKey(shape)) ?? null;
}
function xfrmFlips(shape) {
  const xf = collect(shape, "a:xfrm")[0];
  const flipH = xf?.["@_flipH"];
  const flipV = xf?.["@_flipV"];
  return {
    flipH: flipH === "1" || flipH === 1,
    flipV: flipV === "1" || flipV === 1
  };
}
function parseConnector(shape, transform, rects, scheme, fillStyles, lnStyles) {
  const rect = resolveRectWithTransform(shape, rects, transform);
  if (!rect) return null;
  const { flipH, flipV } = xfrmFlips(shape);
  const [x1, y1, x2, y2] = flipH && flipV ? [1, 1, 0, 0] : flipH ? [1, 0, 0, 1] : flipV ? [0, 1, 1, 0] : [0, 0, 1, 1];
  const style = shapeFillAndLine(shape, scheme, fillStyles, lnStyles);
  const spPr = collect(shape, "p:spPr")[0];
  const ln = spPr?.["a:ln"];
  const arrow = (end) => end && end["@_type"] !== "none" ? "triangle" : "none";
  const dashVal = ln?.["a:prstDash"]?.["@_val"];
  const dash = dashVal === "sysDot" || dashVal === "dot" ? "dot" : typeof dashVal === "string" && dashVal.toLowerCase().includes("dash") ? "dash" : "solid";
  return {
    ...rect,
    x1,
    y1,
    x2,
    y2,
    strokeColor: style.borderColor ?? "#0f172a",
    strokeWidth: style.borderWidth ?? 1,
    startArrow: arrow(ln?.["a:headEnd"]),
    endArrow: arrow(ln?.["a:tailEnd"]),
    dash
  };
}
function colorFromFill(node, scheme) {
  if (!node) return void 0;
  const fill = node["a:solidFill"];
  if (!fill) return void 0;
  const srgb = fill["a:srgbClr"];
  const v = srgb?.["@_val"];
  if (typeof v === "string" && /^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
  const sc = fill["a:schemeClr"];
  const name = sc?.["@_val"];
  if (typeof name === "string" && scheme[name]) return scheme[name];
  return void 0;
}
function readColorMod(node) {
  const mod = {};
  if (!node) return mod;
  const val = (key) => {
    const child = node[key];
    const v = child?.["@_val"];
    return v != null ? num(v) / 1e5 : void 0;
  };
  mod.lumMod = val("a:lumMod");
  mod.lumOff = val("a:lumOff");
  mod.shade = val("a:shade");
  mod.tint = val("a:tint");
  mod.satMod = val("a:satMod");
  return mod;
}
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max2 = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max2 + min) / 2;
  const d = max2 - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max2) {
      case r:
        h = (g - b) / d % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(h / 60 % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function applyColorMod(hex, mod) {
  if (!mod) return hex;
  let [r, g, b] = hexToRgb(hex);
  if (mod.shade != null) {
    r *= mod.shade;
    g *= mod.shade;
    b *= mod.shade;
  }
  if (mod.tint != null) {
    r = r * mod.tint + 255 * (1 - mod.tint);
    g = g * mod.tint + 255 * (1 - mod.tint);
    b = b * mod.tint + 255 * (1 - mod.tint);
  }
  if (mod.lumMod != null || mod.lumOff != null || mod.satMod != null) {
    let [h, s, l] = rgbToHsl(r, g, b);
    if (mod.satMod != null) s *= mod.satMod;
    if (mod.lumMod != null) l *= mod.lumMod;
    if (mod.lumOff != null) l += mod.lumOff;
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    [r, g, b] = hslToRgb(h, s, l);
  }
  return rgbToHex(r, g, b);
}
function styleListEntries(listNode) {
  if (!listNode) return [];
  const out = [];
  for (const [k, v] of Object.entries(listNode)) {
    if (k.startsWith("@_")) continue;
    if (Array.isArray(v)) out.push(...v.map((node) => ({ tag: k, node })));
    else out.push({ tag: k, node: v });
  }
  return out;
}
function fillEntryColorMod(entry) {
  if (!entry) return {};
  if (entry.tag === "a:gradFill") {
    const gsLst = entry.node["a:gsLst"];
    const gsArr = gsLst?.["a:gs"];
    const firstGs = Array.isArray(gsArr) ? gsArr[0] : gsArr;
    return readColorMod(firstGs?.["a:schemeClr"]);
  }
  return readColorMod(entry.node["a:schemeClr"]);
}
function lnEntryStyle(entry) {
  if (!entry) return { mod: {} };
  const w = num(entry.node["@_w"]);
  const solid = entry.node["a:solidFill"];
  return {
    widthPx: w > 0 ? clampBorderPx(emuToPx(w)) : void 0,
    mod: readColorMod(solid?.["a:schemeClr"])
  };
}
function buildColorScheme(files, slidePath) {
  const scheme = {};
  const empty = { scheme, fillStyles: [], lnStyles: [] };
  const base = slidePath.split("/").pop();
  const sRels = relsFor(files, slidePath.replace(/\/[^/]+$/, ""), base);
  const layoutTarget = [...sRels.values()].find((t) => /slideLayout/.test(t));
  if (!layoutTarget) return empty;
  const layoutName = layoutTarget.split("/").pop();
  const lRels = relsFor(files, "ppt/slideLayouts", layoutName);
  const masterTarget = [...lRels.values()].find((t) => /slideMaster/.test(t));
  if (!masterTarget) return empty;
  const masterName = masterTarget.split("/").pop();
  const masterXml = findFile(files, "ppt/slideMasters/" + masterName);
  const mRels = relsFor(files, "ppt/slideMasters", masterName);
  const themeTarget = [...mRels.values()].find((t) => /theme/.test(t));
  if (!themeTarget) return empty;
  const themeXml = findFile(files, "ppt/theme/" + themeTarget.split("/").pop());
  if (!themeXml) return empty;
  const theme = parser.parse(strFromU8(themeXml));
  const cs = collect(theme, "a:clrScheme")[0];
  const base16 = {};
  if (cs) {
    for (const [k, v] of Object.entries(cs)) {
      if (k.startsWith("@_")) continue;
      const name = k.replace(/^a:/, "");
      const node = v;
      const srgb = node["a:srgbClr"]?.["@_val"];
      const sys = node["a:sysClr"]?.["@_lastClr"];
      const hex = srgb ?? sys;
      if (typeof hex === "string" && /^[0-9a-fA-F]{6}$/.test(hex)) base16[name] = `#${hex}`;
    }
  }
  Object.assign(scheme, base16);
  if (masterXml) {
    const master = parser.parse(strFromU8(masterXml));
    const clrMap = collect(master, "p:clrMap")[0];
    if (clrMap) {
      for (const [alias, target] of Object.entries(clrMap)) {
        if (alias.startsWith("@_") === false) continue;
        const a = alias.slice(2);
        const t = String(target);
        if (base16[t]) scheme[a] = base16[t];
      }
    }
  }
  scheme.tx1 ??= base16.dk1 ?? "#000000";
  scheme.bg1 ??= base16.lt1 ?? "#ffffff";
  const fmtScheme = collect(theme, "a:fmtScheme")[0];
  const fillStyleLst = fmtScheme?.["a:fillStyleLst"];
  const lnStyleLst = fmtScheme?.["a:lnStyleLst"];
  const fillStyles = styleListEntries(fillStyleLst).map(fillEntryColorMod);
  const lnStyles = styleListEntries(lnStyleLst).map(lnEntryStyle);
  return { scheme, fillStyles, lnStyles };
}
function bgFillNode(doc) {
  const bg = collect(doc, "p:bg")[0];
  return bg ? collect(bg, "p:bgPr")[0] : void 0;
}
function backgroundFromBgPr(bgPr, scheme, resolveRelMedia) {
  if (!bgPr || "a:noFill" in bgPr) return void 0;
  const color = colorFromFill(bgPr, scheme);
  const blipFill = bgPr["a:blipFill"];
  const blip = blipFill ? collect(blipFill, "a:blip")[0] : void 0;
  const relId = blip ? String(blip["@_r:embed"] ?? "") : "";
  const image = relId ? resolveRelMedia(relId) : void 0;
  if (!color && !image) return void 0;
  return { color, image };
}
function resolveBackground(files, slidePath, slideDoc, scheme) {
  const mediaByName = (name) => {
    const bytes = findFile(files, "ppt/media/" + name);
    return bytes ? { bytes, ext: (name.split(".").pop() || "png").toLowerCase() } : void 0;
  };
  const base = slidePath.split("/").pop();
  const sRels = relsFor(files, slidePath.replace(/\/[^/]+$/, ""), base);
  const slideBg = backgroundFromBgPr(bgFillNode(slideDoc), scheme, (relId) => {
    const target = sRels.get(relId);
    return target ? mediaByName(target.split("/").pop()) : void 0;
  });
  if (slideBg) return slideBg;
  const layoutTarget = [...sRels.values()].find((t) => /slideLayout/.test(t));
  if (!layoutTarget) return void 0;
  const layoutName = layoutTarget.split("/").pop();
  const layoutXml = findFile(files, "ppt/slideLayouts/" + layoutName);
  const lRels = relsFor(files, "ppt/slideLayouts", layoutName);
  if (layoutXml) {
    const layoutBg = backgroundFromBgPr(bgFillNode(parser.parse(strFromU8(layoutXml))), scheme, (relId) => {
      const target = lRels.get(relId);
      return target ? mediaByName(target.split("/").pop()) : void 0;
    });
    if (layoutBg) return layoutBg;
  }
  const masterTarget = [...lRels.values()].find((t) => /slideMaster/.test(t));
  if (!masterTarget) return void 0;
  const masterName = masterTarget.split("/").pop();
  const masterXml = findFile(files, "ppt/slideMasters/" + masterName);
  if (!masterXml) return void 0;
  const mRels = relsFor(files, "ppt/slideMasters", masterName);
  return backgroundFromBgPr(bgFillNode(parser.parse(strFromU8(masterXml))), scheme, (relId) => {
    const target = mRels.get(relId);
    return target ? mediaByName(target.split("/").pop()) : void 0;
  });
}
function masterTextStyles(files, slidePath, scheme) {
  const empty = { title: {}, bodyLevels: [] };
  const base = slidePath.split("/").pop();
  const sRels = relsFor(files, slidePath.replace(/\/[^/]+$/, ""), base);
  const layoutTarget = [...sRels.values()].find((t) => /slideLayout/.test(t));
  if (!layoutTarget) return empty;
  const layoutName = layoutTarget.split("/").pop();
  const lRels = relsFor(files, "ppt/slideLayouts", layoutName);
  const masterTarget = [...lRels.values()].find((t) => /slideMaster/.test(t));
  if (!masterTarget) return empty;
  const masterXml = findFile(files, "ppt/slideMasters/" + masterTarget.split("/").pop());
  if (!masterXml) return empty;
  const master = parser.parse(strFromU8(masterXml));
  const styleFromLvl = (lvl) => {
    if (!lvl) return {};
    const defRpr = collect(lvl, "a:defRPr")[0];
    const out = {};
    if (defRpr) {
      const sz = num(defRpr["@_sz"]);
      if (sz > 0) out.fontPt = sz / 100;
      if (defRpr["@_b"] === "1") out.bold = true;
      if (defRpr["@_i"] === "1") out.italic = true;
      const c = colorFromFill(defRpr, scheme);
      if (c) out.color = c;
    }
    const algn = lvl["@_algn"] ?? "";
    if (algn === "ctr") out.align = "center";
    else if (algn === "r") out.align = "right";
    else if (algn === "l") out.align = "left";
    return out;
  };
  const titleNode = collect(master, "p:titleStyle")[0];
  const title = styleFromLvl(titleNode?.["a:lvl1pPr"] ?? titleNode);
  const bodyNode = collect(master, "p:bodyStyle")[0];
  const bodyLevels = [];
  if (bodyNode) {
    for (let i = 1; i <= 9; i++) {
      bodyLevels.push(styleFromLvl(bodyNode[`a:lvl${i}pPr`]));
    }
  }
  return { title, bodyLevels };
}
function bulletPrefix(ppr, lvl) {
  if (!ppr) return "";
  if ("a:buNone" in ppr) return "";
  const hasBullet = "a:buChar" in ppr || "a:buAutoNum" in ppr;
  const indent = "  ".repeat(Math.max(0, lvl));
  const glyph = lvl > 0 ? "\u25E6 " : "\u2022 ";
  return indent + glyph;
}
function paragraphText(p) {
  const runs = collect(p, "a:r");
  let s = "";
  for (const r of runs) {
    const t = r["a:t"];
    if (typeof t === "string") s += t;
    else if (typeof t === "number") s += String(t);
  }
  if (!s) {
    const t = p["a:t"];
    if (typeof t === "string") s = t;
  }
  return s;
}
function shapeLines(shape, levelStyles, isTitle, scheme, fontScalePct, isPlaceholder) {
  const txBody = collect(shape, "p:txBody")[0];
  const paras = collect(txBody ?? shape, "a:p");
  const lines = [];
  const applyScale = (pt) => pt != null && fontScalePct > 0 ? pt * fontScalePct / 1e5 : pt;
  for (const p of paras) {
    const raw = paragraphText(p);
    const ppr = collect(p, "a:pPr")[0];
    const lvl = ppr ? num(ppr["@_lvl"]) : 0;
    let style = isTitle ? { ...levelStyles.title } : { ...levelStyles.bodyLevels[lvl] ?? levelStyles.bodyLevels[0] ?? {} };
    const pDefRpr = ppr ? collect(ppr, "a:defRPr")[0] : void 0;
    if (pDefRpr) {
      const sz = num(pDefRpr["@_sz"]);
      if (sz > 0) style.fontPt = sz / 100;
      if (pDefRpr["@_b"] === "1" || pDefRpr["@_b"] === 1) style.bold = true;
      else if (pDefRpr["@_b"] === "0" || pDefRpr["@_b"] === 0) style.bold = false;
      if (pDefRpr["@_i"] === "1" || pDefRpr["@_i"] === 1) style.italic = true;
      const c = colorFromFill(pDefRpr, scheme);
      if (c) style.color = c;
    }
    const firstRun = collect(p, "a:r")[0];
    const rpr = firstRun ? collect(firstRun, "a:rPr")[0] : void 0;
    if (rpr) {
      const sz = num(rpr["@_sz"]);
      if (sz > 0) style.fontPt = sz / 100;
      if (rpr["@_b"] === "1" || rpr["@_b"] === 1) style.bold = true;
      else if (rpr["@_b"] === "0" || rpr["@_b"] === 0) style.bold = false;
      if (rpr["@_i"] === "1" || rpr["@_i"] === 1) style.italic = true;
      const c = colorFromFill(rpr, scheme);
      if (c) style.color = c;
    }
    const algn = ppr?.["@_algn"];
    if (algn === "ctr") style.align = "center";
    else if (algn === "r") style.align = "right";
    else if (algn === "l") style.align = "left";
    style.fontPt = style.fontPt != null ? clampFontPt(applyScale(style.fontPt)) : void 0;
    let prefix = "";
    if (!isTitle && isPlaceholder && raw.trim()) {
      prefix = bulletPrefix(ppr, lvl);
    }
    lines.push({
      text: prefix + raw,
      fontPt: style.fontPt,
      color: style.color,
      bold: style.bold,
      italic: style.italic,
      align: style.align
    });
  }
  while (lines.length && !lines[lines.length - 1].text.trim()) lines.pop();
  const text = lines.map((l) => l.text).join("\n");
  return { lines, text };
}
function findFile(files, path) {
  return files[path] ?? files[path.replace(/^\/+/, "")];
}
function slideOrder(files) {
  const presXml = findFile(files, "ppt/presentation.xml");
  const relsXml = findFile(files, "ppt/_rels/presentation.xml.rels");
  if (!presXml || !relsXml) {
    return Object.keys(files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => num(a.match(/(\d+)/)?.[1]) - num(b.match(/(\d+)/)?.[1]));
  }
  const rels = parser.parse(strFromU8(relsXml));
  const relList = collect(rels, "Relationship");
  const idToTarget = /* @__PURE__ */ new Map();
  for (const r of relList) {
    idToTarget.set(String(r["@_Id"]), String(r["@_Target"]));
  }
  const pres = parser.parse(strFromU8(presXml));
  const ids = collect(pres, "p:sldId");
  const paths = [];
  for (const s of ids) {
    const rid = String(s["@_r:id"]);
    const target = idToTarget.get(rid);
    if (target) paths.push("ppt/" + target.replace(/^\/?ppt\//, "").replace(/^\.\.\//, ""));
  }
  return paths;
}
function slideRels(files, slidePath) {
  const base = slidePath.split("/").pop();
  const relsPath = slidePath.replace(/[^/]+$/, "") + "_rels/" + base + ".rels";
  const relsXml = findFile(files, relsPath);
  const map = /* @__PURE__ */ new Map();
  if (!relsXml) return map;
  const rels = parser.parse(strFromU8(relsXml));
  for (const r of collect(rels, "Relationship")) {
    map.set(String(r["@_Id"]), String(r["@_Target"]));
  }
  return map;
}
function resolveMedia(target) {
  return ("ppt/slides/" + target).replace(/\/[^/]+\/\.\.\//g, "/");
}
function relsFor(files, dir, name) {
  const map = /* @__PURE__ */ new Map();
  const xml = findFile(files, `${dir}/_rels/${name}.rels`);
  if (!xml) return map;
  const rels = parser.parse(strFromU8(xml));
  for (const r of collect(rels, "Relationship")) {
    map.set(String(r["@_Id"]), String(r["@_Target"]));
  }
  return map;
}
function parsePptx(buf) {
  const files = unzipSync(buf);
  let slideW = 1280;
  let slideH = 720;
  const presXml = findFile(files, "ppt/presentation.xml");
  if (presXml) {
    const pres = parser.parse(strFromU8(presXml));
    const sz = collect(pres, "p:sldSz")[0];
    if (sz) {
      slideW = posNum(emuToPx(num(sz["@_cx"])), slideW);
      slideH = posNum(emuToPx(num(sz["@_cy"])), slideH);
    }
  }
  const order = slideOrder(files);
  const slides = [];
  for (const slidePath of order) {
    const xml = findFile(files, slidePath);
    if (!xml) continue;
    const doc = parser.parse(strFromU8(xml));
    const rels = slideRels(files, slidePath);
    const { scheme, fillStyles, lnStyles } = buildColorScheme(files, slidePath);
    const masterStyles = masterTextStyles(files, slidePath, scheme);
    const info = layoutInfo(files, slidePath, scheme);
    const images = [];
    for (const lp of info.pics) {
      const dir = lp.layoutName.includes("Master") || lp.layoutName.startsWith("slideMaster") ? "ppt/slideMasters" : "ppt/slideLayouts";
      const target = relsFor(files, dir, lp.layoutName).get(lp.relId);
      if (!target) continue;
      const name = target.split("/").pop();
      const bytes = findFile(files, "ppt/media/" + name);
      if (!bytes) continue;
      images.push({ ...lp.rect, bytes, ext: (name.split(".").pop() || "png").toLowerCase() });
    }
    const spTree = collectSpTree(doc);
    const texts = [];
    for (const { shape: sp, transform } of spTree.shapes) {
      const rect = resolveRectWithTransform(sp, info.rects, transform);
      const ph = placeholderKey(sp);
      const isTitle = ph?.type === "title" || ph?.type === "ctrTitle";
      const naf = collect(sp, "a:normAutofit")[0];
      const scalePct = naf ? num(naf["@_fontScale"]) : 0;
      const { lines, text } = shapeLines(sp, masterStyles, !!isTitle, scheme, scalePct, !!ph);
      if (!text.trim()) continue;
      const finalRect = rect ?? { x: emuToPx(457200), y: texts.length === 0 ? emuToPx(274638) : emuToPx(1600200), width: posNum(slideW - emuToPx(914400), slideW), height: emuToPx(800100) };
      const head = lines.find((l) => l.text.trim()) ?? lines[0];
      const boxStyle = shapeFillAndLine(sp, scheme, fillStyles, lnStyles);
      texts.push({
        ...finalRect,
        text,
        lines,
        fontPt: head?.fontPt,
        color: head?.color,
        bold: head?.bold,
        italic: head?.italic,
        align: head?.align,
        fill: boxStyle.fill,
        borderColor: boxStyle.borderColor,
        borderWidth: boxStyle.borderWidth
      });
    }
    for (const { shape: pic, transform } of spTree.pics) {
      const rect = resolveRectWithTransform(pic, info.rects, transform);
      const blip = collect(pic, "a:blip")[0];
      const embed = blip ? String(blip["@_r:embed"]) : "";
      const target = rels.get(embed);
      if (!rect || !target) continue;
      const mediaPath = resolveMedia(target);
      const bytes = findFile(files, mediaPath) ?? findFile(files, "ppt/media/" + target.split("/").pop());
      if (!bytes) continue;
      const ext = (target.split(".").pop() || "png").toLowerCase();
      const picStyle = shapeFillAndLine(pic, scheme, fillStyles, lnStyles);
      const crop = imageCrop(pic);
      images.push({
        ...rect,
        bytes,
        ext,
        borderColor: picStyle.borderColor,
        borderWidth: picStyle.borderWidth,
        ...crop ? { crop } : {}
      });
    }
    const tables = [];
    for (const gf of collect(doc, "p:graphicFrame")) {
      if (graphicFrameKind(gf) !== "table") continue;
      const table = parseTable(gf, scheme);
      if (table) tables.push(table);
    }
    const connectors = [];
    for (const { shape: cxn, transform } of spTree.connectors) {
      const connector = parseConnector(cxn, transform, info.rects, scheme, fillStyles, lnStyles);
      if (connector) connectors.push(connector);
    }
    const background = resolveBackground(files, slidePath, doc, scheme);
    warnUnsupportedContent(doc, slides.length + 1);
    slides.push({ texts, images, tables, connectors, ...background ? { background } : {} });
  }
  return { slideW, slideH, slides };
}
function graphicFrameKind(gf) {
  if (collect(gf, "a:tbl").length) return "table";
  const graphicData = collect(gf, "a:graphicData")[0];
  const uri = graphicData ? String(graphicData["@_uri"] ?? "") : "";
  if (uri.includes("chart")) return "chart";
  if (uri.includes("diagram")) return "SmartArt diagram";
  return "unsupported graphic frame";
}
function graphicFrameRect(gf) {
  const xf = collect(gf, "p:xfrm")[0];
  if (!xf) return null;
  const off = xf["a:off"];
  const ext = xf["a:ext"];
  if (!off || !ext) return null;
  const width = emuToPx(num(ext["@_cx"]));
  const height = emuToPx(num(ext["@_cy"]));
  if (width <= 0 || height <= 0) return null;
  return { x: emuToPx(num(off["@_x"])), y: emuToPx(num(off["@_y"])), width, height };
}
function cellBorder(tcPr, scheme) {
  if (!tcPr) return {};
  for (const key of ["a:lnL", "a:lnR", "a:lnT", "a:lnB"]) {
    const ln = tcPr[key];
    if (!ln || "a:noFill" in ln) continue;
    const color = colorFromFill(ln, scheme);
    if (color) {
      const w = num(ln["@_w"]);
      return { color, width: w > 0 ? clampBorderPx(emuToPx(w)) : 1 };
    }
  }
  return {};
}
function parseTable(gf, scheme) {
  const rect = graphicFrameRect(gf);
  const tbl = collect(gf, "a:tbl")[0];
  if (!rect || !tbl) return null;
  const tblGrid = collect(tbl, "a:tblGrid")[0];
  const gridCols = tblGrid ? collect(tblGrid, "a:gridCol") : [];
  const colWidths = gridCols.map((c) => emuToPx(num(c["@_w"])));
  const rows = collect(tbl, "a:tr");
  const rowHeights = rows.map((r) => emuToPx(num(r["@_h"])));
  let borderColor;
  let borderWidth;
  const cells = rows.map((row) => {
    const tcs = collect(row, "a:tc");
    return tcs.map((tc) => {
      if ("@_hMerge" in tc || "@_vMerge" in tc) return null;
      const { lines, text } = shapeLines(tc, { title: {}, bodyLevels: [] }, false, scheme, 0, false);
      const tcPr = collect(tc, "a:tcPr")[0];
      const fill = tcPr ? colorFromFill(tcPr, scheme) : void 0;
      const border = cellBorder(tcPr, scheme);
      if (border.color && !borderColor) {
        borderColor = border.color;
        borderWidth = border.width;
      }
      const head = lines.find((l) => l.text.trim()) ?? lines[0];
      const colSpan = num(tc["@_gridSpan"]);
      const rowSpan = num(tc["@_rowSpan"]);
      return {
        text,
        fill,
        color: head?.color,
        bold: head?.bold,
        align: head?.align,
        ...colSpan > 1 ? { colSpan } : {},
        ...rowSpan > 1 ? { rowSpan } : {}
      };
    });
  });
  return { ...rect, colWidths, rowHeights, cells, borderColor, borderWidth };
}
function warnUnsupportedContent(doc, slideNum) {
  const graphicFrames = collect(doc, "p:graphicFrame");
  for (const kind of new Set(graphicFrames.map(graphicFrameKind))) {
    if (kind === "table") continue;
    const count = graphicFrames.filter((gf) => graphicFrameKind(gf) === kind).length;
    console.warn(`[pptx import] Slide ${slideNum}: skipped ${count} ${kind}${count > 1 ? "s" : ""} (unsupported).`);
  }
  const videoRefs = collect(doc, "a:videoFile");
  if (videoRefs.length) {
    console.warn(`[pptx import] Slide ${slideNum}: ${videoRefs.length} video(s) imported as a static poster image only \u2014 playback isn't supported.`);
  }
  const audioRefs = collect(doc, "a:audioFile");
  if (audioRefs.length) {
    console.warn(`[pptx import] Slide ${slideNum}: skipped ${audioRefs.length} audio clip(s) (unsupported).`);
  }
  if (collect(doc, "p:timing").length) {
    console.warn(`[pptx import] Slide ${slideNum}: skipped animation/timing data (unsupported).`);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isParsedDeckWire,
  parsePptx,
  toWireDeck
});
