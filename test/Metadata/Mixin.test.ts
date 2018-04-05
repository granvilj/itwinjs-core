/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2018 Bentley Systems, Incorporated. All rights reserved. $
*--------------------------------------------------------------------------------------------*/

import { assert, expect } from "chai";
import Schema, { MutableSchema } from "../../source/Metadata/Schema";
import EntityClass from "../../source/Metadata/EntityClass";
import Mixin from "../../source/Metadata/Mixin";
import { ECObjectsError } from "../../source/Exception";

describe("Mixin", () => {
  describe("deserialization", () => {
    function createSchemaJsonWithItems(itemsJson: any): any {
      return {
        $schema: "https://dev.bentley.com/json_schemas/ec/31/draft-01/ecschema",
        name: "TestSchema",
        version: "1.2.3",
        items: {
          ...itemsJson,
        },
      };
    }
    function createSchemaJson(mixinJson: any): any {
      return createSchemaJsonWithItems({
        TestMixin: {
          schemaItemType: "Mixin",
          ...mixinJson,
        },
        TestEntity: {
          schemaItemType: "EntityClass",
        },
      });
    }

    it("should succeed with fully defined", async () => {
      const testSchema = createSchemaJsonWithItems({
        TestMixin: {
          schemaItemType: "Mixin",
          baseClass: "TestSchema.BaseMixin",
          appliesTo: "TestSchema.TestEntity",
        },
        BaseMixin: {
          schemaItemType: "Mixin",
          appliesTo: "TestSchema.TestEntity",
        },
        TestEntity: {
          schemaItemType: "EntityClass",
        },
      });

      const schema = await Schema.fromJson(testSchema);
      assert.isDefined(schema);

      const entity = await schema.getItem<EntityClass>("TestEntity");
      const baseMixin = await schema.getItem<Mixin>("BaseMixin");

      const mixin = await schema.getItem<Mixin>("TestMixin");
      assert.isDefined(mixin);

      assert.isDefined(await mixin!.appliesTo);
      assert.isTrue(await mixin!.appliesTo === entity);
      assert.isTrue(await mixin!.baseClass === baseMixin);
    });

    it("should throw for NavigationProperty", async () => {
      const json = createSchemaJson({
        appliesTo: "TestSchema.TestEntity",
        properties: [{ name: "navProp", propertyType: "NavigationProperty" }],
      });
      await expect(Schema.fromJson(json)).to.be.rejectedWith(ECObjectsError, `The Navigation Property TestMixin.navProp is invalid, because only EntityClasses and RelationshipClasses can have NavigationProperties.`);
    });

    it("should throw for invalid appliesTo", async () => {
      const json = createSchemaJson({
        appliesTo: 0,
      });
      await expect(Schema.fromJson(json)).to.be.rejectedWith(ECObjectsError, `The Mixin TestMixin has an invalid 'appliesTo' property. It should be of type 'string'.`);
    });
  });

  describe("fromJson", () => {
    let testEntity: EntityClass;
    let testMixin: Mixin;
    const baseJson = { schemaItemType: "Mixin" };

    beforeEach(async () => {
      const schema = new Schema("TestSchema", 1, 0, 0);
      testEntity = await (schema as MutableSchema).createEntityClass("TestEntity");
      testMixin = new Mixin(schema, "TestMixin");
    });

    it("should successfully deserialize valid JSON", async () => {
      const json = {
        ...baseJson,
        appliesTo: "TestSchema.TestEntity",
      };
      expect(testMixin).to.exist;
      await testMixin.fromJson(json);

      expect(await testMixin.appliesTo).to.eql(testEntity);
    });

    it("should throw for missing appliesTo", async () => {
      expect(testMixin).to.exist;
      await expect(testMixin.fromJson({...baseJson})).to.be.rejectedWith(ECObjectsError, `The Mixin TestMixin is missing the required 'appliesTo' attribute.`);
    });

    it("should throw for invalid appliesTo", async () => {
      expect(testMixin).to.exist;
      const invalidAppliesToJson = { ...baseJson, appliesTo: 0 };
      await expect(testMixin.fromJson(invalidAppliesToJson)).to.be.rejectedWith(ECObjectsError, `The Mixin TestMixin has an invalid 'appliesTo' attribute. It should be of type 'string'.`);

      const unloadedAppliesToJson = { ...baseJson, appliesTo: "ThisClassDoesNotExist" };
      await expect(testMixin.fromJson(unloadedAppliesToJson)).to.be.rejectedWith(ECObjectsError);
    });
  });
});
